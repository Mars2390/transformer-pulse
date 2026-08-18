import type { Column, Content } from "pdfmake/interfaces";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { pdf } from "@/lib/report-response";
import { buildPdf, dataTable, sectionTitle, KPLC_NAVY } from "@/lib/pdf";
import { buildPriorityList, bandOf, type PriorityRow } from "@/lib/combined-health";
import { ROLE_LABELS } from "@/lib/format";

/**
 * GET /api/pdf/priority?band=RED&defect=pole&region=Nairobi
 *
 * The repair queue as a document somebody can carry into a planning meeting.
 *
 * The XLSX next door is the working file — every column, sortable, filterable.
 * This is the other half of the same question: the ranked list with the reasons
 * spelled out, in a form that survives being printed and put in front of people
 * who are deciding what gets a crew this week.
 *
 * It takes the SAME band/defect/region filters as /manager/priority, so the
 * button exports the slice on screen rather than silently exporting everything.
 * A filtered export that quietly ignores the filter is worse than no export.
 */

const BAND_FILL: Record<string, string | undefined> = {
  RED: "#fee2e2",
  AMBER: "#fef3c7",
  // Green rows keep the zebra striping — colouring "fine" draws the eye to
  // exactly the rows that do not need it.
  GREEN: undefined,
  UNKNOWN: "#f1f5f9",
};

/** The same defect predicates the page uses, kept in one place. */
const DEFECTS: Record<string, (r: PriorityRow) => boolean> = {
  phase: (r) => r.peakPhasePct != null && r.peakPhasePct >= 100,
  pole: (r) => r.structure === "ROTTEN" || r.structure === "LEANING",
  earth: (r) => r.openEarth,
  fuse: (r) => r.fuseCarriersBad,
  ir: (r) => r.irLowMohm != null,
};

const DEFECT_LABELS: Record<string, string> = {
  phase: "phase overload at or above 100% of rated",
  pole: "pole leaning or rotten",
  earth: "no effective earth (OL)",
  fuse: "fuse carriers needing replacement",
  ir: "insulation resistance recorded",
};

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("ADMIN", "MANAGER");
    const url = new URL(request.url);

    const band = url.searchParams.get("band");
    const defect = url.searchParams.get("defect");
    // A manager is pinned to their own region regardless of what the query
    // string says. Same rule as the XLSX route — the export must not be a way
    // around region scoping.
    const region = user.role === "MANAGER" ? user.region : url.searchParams.get("region");

    const all = await buildPriorityList({ region });

    const defectTest = defect ? DEFECTS[defect] : undefined;
    const rows = all.filter((r) => {
      if (band && bandOf(r.priority) !== band) return false;
      if (defectTest && !defectTest(r)) return false;
      return true;
    });

    const counts = {
      red: rows.filter((r) => bandOf(r.priority) === "RED").length,
      amber: rows.filter((r) => bandOf(r.priority) === "AMBER").length,
      green: rows.filter((r) => bandOf(r.priority) === "GREEN").length,
      unscored: rows.filter((r) => r.electrical == null && r.physical == null).length,
    };

    const content: Content[] = [];

    content.push(sectionTitle("Summary"));
    content.push({
      columns: [
        tile("Transformers listed", String(rows.length)),
        tile("Act now (red)", String(counts.red)),
        tile("Watch (amber)", String(counts.amber)),
        tile("Not yet measured", String(counts.unscored)),
      ],
      columnGap: 10,
      margin: [0, 0, 0, 14],
    });

    const filterNote: string[] = [];
    if (band) filterNote.push(`band ${band}`);
    if (defect) filterNote.push(DEFECT_LABELS[defect] ?? defect);
    if (region) filterNote.push(`region ${region}`);
    content.push({
      stack: [
        {
          text: filterNote.length
            ? `Filtered to ${filterNote.join(", ")}. ${all.length - rows.length} of ${all.length} scored transformers are excluded by that filter.`
            : `Every transformer currently in service or faulty: ${rows.length} scored.`,
          fontSize: 9,
        },
        {
          text: `${counts.unscored} of these have neither an electrical nor a physical score. That is not a clean bill of health — nobody has measured them.`,
          fontSize: 9,
          margin: [0, 4, 0, 0],
        },
      ],
      margin: [0, 0, 0, 6],
    });

    const actNow = rows.filter((r) => bandOf(r.priority) === "RED");
    if (actNow.length > 0) {
      content.push({ text: "Act now", style: "h2", margin: [0, 14, 0, 6] });
      content.push(
        dataTable(
          ["Rank", "G-Number", "kVA", "Site", "Priority", "Leading reason"],
          actNow.map((r) => [
            all.indexOf(r) + 1,
            r.gNumber ?? r.serialNumber,
            r.ratingKva,
            r.siteName ?? r.substationCode ?? "—",
            r.priority,
            r.topReason,
          ]),
          ["auto", "auto", 28, "*", "auto", "*"],
          () => BAND_FILL.RED,
        ),
      );
    }

    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle(`Ranked repair queue (${rows.length})`));

    content.push(
      dataTable(
        [
          "Rank",
          "G-Number",
          "Serial",
          "kVA",
          "Region",
          "Substation",
          "Site",
          "Priority",
          "Band",
          "Electrical",
          "Physical",
          "Last inspected",
        ],
        rows.map((r, i) => [
          i + 1,
          r.gNumber ?? "—",
          r.serialNumber,
          r.ratingKva,
          r.region ?? "—",
          r.substationCode ?? "—",
          r.siteName ?? "—",
          r.priority,
          bandOf(r.priority),
          // Spelled out rather than blank: a reader must not be able to mistake
          // an unmeasured transformer for a healthy one.
          r.electrical ?? "not measured",
          r.physical ?? "not measured",
          r.lastInspectionAt ? r.lastInspectionAt.toISOString().slice(0, 10) : "never",
        ]),
        ["auto", "auto", "auto", 28, "auto", "auto", "*", "auto", "auto", "auto", "auto", "auto"],
        (row) => BAND_FILL[String(row[8])],
      ),
    );

    // The table above ranks. This says WHY, which is what a planning meeting
    // actually argues about.
    const withReasons = rows.filter((r) => r.reasons.length > 0);
    if (withReasons.length > 0) {
      content.push({ text: "", pageBreak: "before" });
      content.push(sectionTitle("Findings behind the ranking"));
      content.push(
        dataTable(
          ["Rank", "G-Number", "Findings"],
          withReasons.map((r) => [rows.indexOf(r) + 1, r.gNumber ?? r.serialNumber, r.reasons.join("; ")]),
          ["auto", "auto", "*"],
        ),
      );
    }

    content.push({
      margin: [0, 16, 0, 0],
      stack: [
        {
          text: "How this ranking is built",
          fontSize: 9,
          bold: true,
          color: KPLC_NAVY,
        },
        {
          ul: [
            "Two scores, not one. Electrical stress is measured from EMDis telemetry; physical condition is observed at inspection.",
            "Priority weights the WORSE of the two axes at 70%, so either alone can escalate a transformer.",
            "A blank score means not measured. It is not a good score.",
            "An earth reading of OL means over range: there is no effective earth.",
          ],
          fontSize: 8,
          margin: [0, 4, 0, 0],
        },
      ],
    });

    const buffer = await buildPdf({
      landscape: true,
      cover: {
        title: "Repair Priority List",
        headline: region ?? "All regions",
        subhead: `${rows.length} transformers, worst first`,
        meta: [
          ["Generated by", `${user.name} (${ROLE_LABELS[user.role]})`],
          ["Date", new Date().toLocaleString("en-GB")],
          ["Act now", `${counts.red} red, ${counts.amber} amber, ${counts.green} green`],
          ["Filter", filterNote.length ? filterNote.join(", ") : "None — full queue"],
        ],
      },
      content,
    });

    return pdf(buffer, "repair-priority");
  } catch (error) {
    return apiError(error);
  }
}

/** One summary tile. Typed as Column — `width` is a column property, not a content one. */
function tile(label: string, value: string): Column {
  return {
    width: "*",
    stack: [
      { text: label.toUpperCase(), fontSize: 7, color: "#5b6480", bold: true },
      { text: value, fontSize: 16, bold: true, color: KPLC_NAVY, margin: [0, 3, 0, 0] },
    ],
  };
}
