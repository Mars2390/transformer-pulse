import { NextResponse } from "next/server";
import type { Content } from "pdfmake/interfaces";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { pdf } from "@/lib/report-response";
import {
  buildPdf, dataTable, detailTable, sectionTitle, embedPhotos,
  KPLC_GREEN, KPLC_NAVY, STATUS_FILL,
} from "@/lib/pdf";
import { verifyChain, type ChainLink } from "@/lib/chain";
import { computeWarranty } from "@/lib/warranty";
import { computeHealth, HEALTH_BAND_META } from "@/lib/health";
import { dmy, gps, trend } from "@/lib/report-data";
import { EVENT_META, ROLE_LABELS, STATUS_META, formatKes, formatPlate } from "@/lib/format";
import { unit } from "@/lib/measure";

/**
 * GET /api/pdf/transformer/[id] — the complete story of one transformer.
 *
 * Cover, asset summary, nameplate, full timeline, test history with trend,
 * warranty and chain proof, then photographs. This is the document a manager
 * puts in front of a room, or attaches to a dispute.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const viewer = await requireApiUser();
    const { id } = await context.params;

    const tx = await prisma.transformer.findUnique({
      where: { id },
      include: {
        manufacturer: true,
        currentStore: { select: { name: true } },
        events: { orderBy: { occurredAt: "asc" }, include: { user: { select: { name: true, role: true } }, tests: true } },
        tests: { orderBy: { testedAt: "desc" }, include: { testedBy: { select: { name: true } } } },
        claims: { include: { manufacturer: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!tx) return NextResponse.json({ error: "Transformer not found." }, { status: 404 });

    const label = tx.gNumber ?? tx.serialNumber;
    const chain = verifyChain(tx.events as unknown as ChainLink[]);
    const w = computeWarranty(tx.warrantyStart, tx.warrantyMonths);
    const faults = tx.events.filter((e) => e.type === "FAULT_REPORTED").length;
    const health = computeHealth({
      latestTest: tx.tests[0] ?? null,
      failureCount: faults,
      ageYears: new Date().getFullYear() - tx.yearOfManufacture,
    });

    const content: Content[] = [];

    content.push(sectionTitle("Asset summary"));
    content.push(detailTable([
      ["G-Number", tx.gNumber ?? "Not assigned"],
      ["Serial number", tx.serialNumber],
      ["Manufacturer", tx.manufacturer.name],
      ["Rating", `${tx.ratingKva} kVA`],
      ["Voltage", `${tx.primaryKv} / ${tx.secondaryKv} kV`],
      ["Phases", `${tx.phases} phase`],
      ["Cooling", tx.coolingType],
      ["Vector group", tx.vectorGroup],
      ["Impedance", tx.impedancePct != null ? `${tx.impedancePct} %` : null],
      ["Oil volume", tx.oilVolumeLitres != null ? `${tx.oilVolumeLitres} litres` : null],
      ["Year of manufacture", tx.yearOfManufacture],
      ["Status", STATUS_META[tx.status].label],
      ["Location", tx.currentSiteName],
      ["Feeder", tx.feeder],
      ["Region", tx.region],
      ["Store", tx.currentStore?.name ?? null],
      ["GPS coordinates", tx.currentLat != null ? `${gps(tx.currentLat)}, ${gps(tx.currentLng)}` : null],
      ["Installation date", dmy(tx.commissionDate)],
      ["Warranty expiry", dmy(w.expiresAt)],
      ["Health score", `${health.score} / 100 — ${HEALTH_BAND_META[health.band].label}`],
    ]));

    const plate: [string, string | number | null][] = [
      ["Frequency", unit(tx.frequencyHz, "Hz")],
      ["Duty", tx.duty],
      ["Standard", tx.standardRef],
      ["HV insulation level / BIL", tx.hvInsulationLevelKv],
      ["Temp rise — oil", unit(tx.tempRiseOilC, "°C")],
      ["Temp rise — winding", unit(tx.tempRiseWindingC, "°C")],
      ["Temperature class", tx.tempClass],
      ["Max ambient temperature", unit(tx.maxAmbientTempC, "°C")],
      ["Insulation oil type", tx.insulationOilType],
      ["Oil weight", unit(tx.oilWeightKg, "kg")],
      ["Total weight", unit(tx.totalWeightKg, "kg")],
      ["Tap range", tx.tapRange],
    ];
    const missing = plate.filter(([, v]) => v == null || v === "").length;
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Nameplate details"));
    content.push(detailTable(plate));
    if (missing > 0) {
      content.push({
        text: `${missing} nameplate field${missing === 1 ? "" : "s"} not yet recorded. Complete them from the physical plate to finish this record.`,
        style: "muted", margin: [0, 8, 0, 0],
      });
    }

    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Timeline — the complete story"));
    content.push({
      text: `${tx.events.length} events, oldest first. Each carries the hash that links it to the one before.`,
      style: "muted", margin: [0, 0, 0, 10],
    });

    for (const e of tx.events) {
      const meta = EVENT_META[e.type];
      const test = e.tests[0];
      const lines: string[] = [];
      lines.push(`${e.user.name} · ${ROLE_LABELS[e.user.role] ?? e.user.role}`);
      if (e.lat != null) lines.push(`GPS ${gps(e.lat)}, ${gps(e.lng)}${e.accuracyM ? ` (±${Math.round(e.accuracyM)} m)` : ""}`);
      if (e.locationName) lines.push(e.locationName);
      if (e.vehiclePlate) lines.push(`Vehicle ${formatPlate(e.vehiclePlate)}${e.driverName ? ` · Driver ${e.driverName}` : ""}`);
      if (test) {
        const bits = [
          test.oilBdvKv != null ? `Oil BDV ${test.oilBdvKv} kV` : null,
          test.insulationResistanceHvMohm != null ? `IR HV ${test.insulationResistanceHvMohm} MΩ` : null,
          test.passed ? "PASS" : "FAIL",
        ].filter(Boolean);
        lines.push(`Test — ${bits.join(", ")}`);
      }
      if (e.notes) lines.push(e.notes);

      // unbreakable: an event must never be split across a page boundary.
      content.push({
        unbreakable: true,
        margin: [0, 0, 0, 8],
        table: {
          widths: [3, "*"],
          body: [[
            { text: "", fillColor: KPLC_GREEN },
            {
              stack: [
                {
                  columns: [
                    { text: meta.label, bold: true, color: KPLC_NAVY, fontSize: 10, width: "*" },
                    { text: dmy(e.occurredAt), fontSize: 8, color: "#5b6480", width: "auto" },
                  ],
                },
                ...lines.map((t) => ({ text: t, fontSize: 8, color: "#3d4343", margin: [0, 1, 0, 0] as [number, number, number, number] })),
                { text: `hash …${e.hash.slice(-8)}`, fontSize: 7, color: "#9aa0ae", margin: [0, 3, 0, 0] },
              ],
              margin: [8, 6, 6, 6],
            },
          ]],
        },
        layout: {
          hLineWidth: () => 0, vLineWidth: () => 0,
          fillColor: (rowIndex: number, node: unknown, columnIndex: number) => (columnIndex === 1 ? "#f7f8fa" : null),
        },
      });
    }

    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Test history"));
    content.push(dataTable(
      ["Date", "Stage", "IR HV (MΩ)", "IR LV (MΩ)", "Ratio dev (%)", "Oil BDV (kV)", "Result"],
      tx.tests.map((t) => [
        dmy(t.testedAt), t.stage.replace(/_/g, " "),
        t.insulationResistanceHvMohm, t.insulationResistanceLvMohm,
        t.turnsRatioDeviationPct, t.oilBdvKv, t.passed ? "PASS" : "FAIL",
      ]),
      ["auto", "auto", "*", "*", "*", "*", "auto"],
      (row) => (row[6] === "FAIL" ? "#fee2e2" : undefined),
    ));

    const chronological = [...tx.tests].reverse();
    const bdv = trend(chronological.map((t) => t.oilBdvKv).reverse());
    const irhv = trend(chronological.map((t) => t.insulationResistanceHvMohm).reverse());
    content.push({
      margin: [0, 12, 0, 0],
      stack: [
        { text: "Trends", style: "h2" },
        { text: bdv ? `Oil BDV: ${bdv}` : "Oil BDV: no readings", fontSize: 9, margin: [0, 4, 0, 0] },
        { text: irhv ? `Insulation resistance HV: ${irhv}` : "Insulation resistance HV: no readings", fontSize: 9 },
        { text: `Health assessment: ${health.score}/100 — ${HEALTH_BAND_META[health.band].label}`, fontSize: 9, bold: true, margin: [0, 6, 0, 0] },
        ...health.reasons.map((r) => ({ text: `• ${r}`, style: "muted" as const })),
      ],
    });

    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Warranty"));
    content.push(detailTable([
      ["Warranty period", `${tx.warrantyMonths} months`],
      ["Starts", dmy(tx.warrantyStart)],
      ["Expires", dmy(w.expiresAt)],
      ["Days remaining", w.daysRemaining != null ? String(w.daysRemaining) : "Not started"],
      ["Status", w.state.replace(/_/g, " ")],
      ["Claimable now", w.claimable ? "Yes" : "No"],
    ]));

    if (tx.claims.length) {
      content.push({ text: "Claims", style: "h2", margin: [0, 12, 0, 6] });
      content.push(dataTable(
        ["Raised", "Manufacturer", "Fault", "Value (KES)", "Status"],
        tx.claims.map((c) => [
          dmy(c.createdAt), c.manufacturer.name, c.faultReason,
          c.claimValueKes ? formatKes(Number(c.claimValueKes)) : "—", c.status,
        ]),
        ["auto", "auto", "*", "auto", "auto"],
      ));
    }

    content.push(sectionTitle("Custody chain verification"));
    content.push({
      margin: [0, 0, 0, 10],
      table: { widths: ["*"], body: [[{
        text: chain.valid
          ? `Chain verified — ${chain.checked} events, unbroken.`
          : `CHAIN BROKEN — ${chain.reason ?? "a hash does not match its contents."}`,
        bold: true, color: chain.valid ? "#065f46" : "#991b1b",
        fillColor: chain.valid ? "#d1fae5" : "#fee2e2", margin: [10, 8, 10, 8],
      }]] },
      layout: "noBorders",
    });
    content.push({
      text: "Each event stores sha256(previous hash + its own contents). Editing any past event changes its hash and every hash after it, so tampering cannot be hidden.",
      style: "muted", margin: [0, 0, 0, 8],
    });
    content.push(dataTable(
      ["#", "Event", "Date", "Previous hash", "This hash"],
      tx.events.map((e, i) => [
        i + 1, EVENT_META[e.type].label, dmy(e.occurredAt),
        e.prevHash ? `…${e.prevHash.slice(-12)}` : "genesis",
        `…${e.hash.slice(-12)}`,
      ]),
      [20, "auto", "auto", "*", "*"],
    ));
    content.push({ text: `Verified ${new Date().toLocaleString("en-GB")}`, style: "muted", margin: [0, 6, 0, 0] });

    const withPhotos = tx.events.filter((e) => e.photoUrls.length > 0);
    const flat = withPhotos.flatMap((e) => e.photoUrls.map((url) => ({ url, caption: `${EVENT_META[e.type].label} — ${dmy(e.occurredAt)}` })));
    const embedded = await embedPhotos(flat.map((f) => f.url));

    if (embedded.length) {
      content.push({ text: "", pageBreak: "before" });
      content.push(sectionTitle("Photographs"));
      // Two per row, three rows per page — six per page as specified.
      for (let i = 0; i < embedded.length; i += 2) {
        const pair = embedded.slice(i, i + 2);
        content.push({
          columns: pair.map((p) => {
            const caption = flat.find((f) => f.url === p.url)?.caption ?? "";
            return {
              width: "50%",
              stack: [
                { image: p.data, fit: [230, 165] },
                { text: caption, style: "muted", margin: [0, 3, 0, 0] },
              ],
            };
          }),
          columnGap: 12,
          margin: [0, 0, 0, 14],
          unbreakable: true,
        });
      }
    }

    const buffer = await buildPdf({
      cover: {
        title: "Transformer Story Report",
        headline: label,
        subhead: tx.gNumber ? tx.serialNumber : undefined,
        meta: [
          ["Manufacturer", tx.manufacturer.name],
          ["Rating", `${tx.ratingKva} kVA`],
          ["Status", STATUS_META[tx.status].label],
          ["Region", tx.region ?? "—"],
          ["Generated by", `${viewer.name} (${ROLE_LABELS[viewer.role]})`],
          ["Date", new Date().toLocaleString("en-GB")],
        ],
      },
      content,
    });

    return pdf(buffer, `transformer-story-${label}`);
  } catch (error) {
    return apiError(error);
  }
}
