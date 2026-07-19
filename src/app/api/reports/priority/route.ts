import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { csv, xlsx } from "@/lib/report-response";
import { toCsv, toXlsx, type Column } from "@/lib/reports";
import { buildPriorityList, bandOf, type PriorityRow } from "@/lib/combined-health";

/**
 * GET /api/reports/priority?format=csv|xlsx
 *
 * The repair queue as a file a crew supervisor can work from. Both scores are
 * carried separately, because they mean different things and call out different
 * crews: a rotten pole is a lineman with a new pole, a cooking winding is a
 * load transfer.
 */

type Row = PriorityRow & { rank: number };

const COLUMNS: Column<Row>[] = [
  { header: "Rank", value: (r) => r.rank, width: 7 },
  { header: "G-Number", value: (r) => r.gNumber ?? "", width: 13 },
  { header: "Serial Number", value: (r) => r.serialNumber, width: 20 },
  { header: "Rating kVA", value: (r) => r.ratingKva, width: 11 },
  { header: "Region", value: (r) => r.region ?? "", width: 14 },
  { header: "Substation", value: (r) => r.substationCode ?? "", width: 13 },
  { header: "Site", value: (r) => r.siteName ?? "", width: 30 },
  {
    header: "Priority",
    value: (r) => r.priority,
    width: 10,
    tone: (r) => (bandOf(r.priority) === "RED" ? "critical" : bandOf(r.priority) === "AMBER" ? "warning" : "good"),
  },
  { header: "Band", value: (r) => bandOf(r.priority), width: 9 },
  // "not measured" is spelled out rather than left blank, so a reader cannot
  // mistake an unmeasured transformer for a healthy one.
  { header: "Electrical Stress", value: (r) => r.electrical ?? "not measured", width: 17 },
  { header: "Physical Condition", value: (r) => r.physical ?? "not measured", width: 18 },
  { header: "Peak Phase % Rated", value: (r) => (r.peakPhasePct != null ? Number(r.peakPhasePct.toFixed(1)) : ""), width: 17, numFmt: "0.0" },
  { header: "Max Unbalance %", value: (r) => (r.unbalancePct != null ? Number(r.unbalancePct.toFixed(1)) : ""), width: 15, numFmt: "0.0" },
  { header: "Pole", value: (r) => r.structure ?? "", width: 11 },
  { header: "Earth", value: (r) => (r.openEarth ? "OL — over range, no effective earth" : ""), width: 30 },
  { header: "Fuse Carriers", value: (r) => (r.fuseCarriersBad ? "needs replacement" : ""), width: 17 },
  { header: "IR at 20C (MOhm)", value: (r) => (r.irLowMohm != null ? Number(r.irLowMohm.toFixed(2)) : ""), width: 16, numFmt: "0.00" },
  { header: "Last Inspected", value: (r) => (r.lastInspectionAt ? r.lastInspectionAt.toISOString().slice(0, 10) : "never"), width: 14 },
  { header: "Findings", value: (r) => r.reasons.join("; "), width: 70 },
];

export async function GET(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const region = actor.role === "MANAGER" ? actor.region : url.searchParams.get("region");

    const list = await buildPriorityList({ region });
    const rows: Row[] = list.map((r, i) => ({ ...r, rank: i + 1 }));

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      return csv(toCsv(rows, COLUMNS), `repair-priority-${stamp}`);
    }

    const buffer = await toXlsx({
      rows,
      columns: COLUMNS,
      sheetName: "Repair Priority",
      title: "Repair Priority",
      subtitle: `${rows.length} transformers, worst first`,
      generatedBy: actor.name,
      region: region ?? undefined,
      footerLines: [
        "Two scores, not one. Electrical stress is measured from EMDis telemetry; physical condition is observed at inspection.",
        "Priority weights the WORSE of the two axes at 70%, so either alone can escalate a transformer.",
        "A blank score means not measured. It is not a good score.",
        "An earth reading of OL means over range: there is no effective earth.",
      ],
    });

    return xlsx(buffer, `repair-priority-${stamp}`);
  } catch (error) {
    return apiError(error);
  }
}
