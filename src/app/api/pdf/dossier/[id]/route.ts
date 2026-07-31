import { NextResponse } from "next/server";
import type { Content } from "pdfmake/interfaces";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { pdf } from "@/lib/report-response";
import { buildPdf, dataTable, detailTable, sectionTitle, embedPhotos, KPLC_GREEN } from "@/lib/pdf";
import { verifyChain, type ChainLink } from "@/lib/chain";
import { computeWarranty } from "@/lib/warranty";
import { computeHealth, HEALTH_BAND_META } from "@/lib/health";
import { buildPriorityList } from "@/lib/combined-health";
import { deriveHealthStatus, HEALTH_STATUS_META } from "@/lib/health-status";
import { computeServiceSummary } from "@/lib/service-summary";
import { buildManufacturerPerformance, fleetAverage } from "@/lib/manufacturer-performance";
import { dmy, gps, trend } from "@/lib/report-data";
import { EVENT_META, ROLE_LABELS, STATUS_META, formatKes, formatPlate } from "@/lib/format";

/**
 * GET /api/pdf/dossier/[id] — the "Export Full Dossier" button.
 *
 * Everything the per-transformer PDF has, plus what it doesn't: the service
 * summary, the 5-level health status, a load-analysis summary from EMDis, the
 * KYN inspection history, and how this unit's manufacturer compares to the
 * fleet. One click, one file, boardroom-ready.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
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
        repairs: { orderBy: { receivedAtWorkshop: "desc" } },
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

    const [priorityRows, serviceSummary, inspections, emdisAgg, latestHour, manufacturerRows] = await Promise.all([
      buildPriorityList({ transformerIds: [id], allStatuses: true }),
      computeServiceSummary({
        transformer: { id: tx.id, ratingKva: tx.ratingKva, secondaryKv: tx.secondaryKv, yearOfManufacture: tx.yearOfManufacture, commissionDate: tx.commissionDate },
        events: tx.events.map((e) => ({ type: e.type, toStatus: e.toStatus, occurredAt: e.occurredAt })),
        repairs: tx.repairs.map((r) => ({ receivedAtWorkshop: r.receivedAtWorkshop, repairCompletedAt: r.repairCompletedAt, repairCostKes: r.repairCostKes })),
        testsCount: tx.tests.length,
        claimsCount: tx.claims.length,
      }),
      prisma.substationInspection.findMany({ where: { transformerId: id }, orderBy: { inspectedOn: "desc" } }),
      prisma.emdisDataset.aggregate({ where: { transformerId: id }, _sum: { readingCount: true }, _count: { _all: true } }),
      prisma.emdisHourly.findFirst({ where: { transformerId: id }, orderBy: { hourStart: "desc" } }),
      buildManufacturerPerformance(),
    ]);

    const priorityRow = priorityRows[0] ?? null;
    const healthStatus = deriveHealthStatus({
      electrical: priorityRow?.electrical ?? null,
      physical: priorityRow?.physical ?? null,
      status: tx.status,
      reasons: priorityRow?.reasons ?? [],
    });

    const content: Content[] = [];

    // === Birth certificate + service summary + health status ================
    content.push(sectionTitle("Birth certificate"));
    content.push(detailTable([
      ["G-Number", tx.gNumber ?? "Not assigned"],
      ["Serial number", tx.serialNumber],
      ["Manufacturer", tx.manufacturer.name],
      ["Rating", `${tx.ratingKva} kVA`],
      ["Voltage", `${tx.primaryKv} / ${tx.secondaryKv} kV`],
      ["Phases", `${tx.phases} phase`],
      ["Cooling", tx.coolingType],
      ["Vector group", tx.vectorGroup],
      ["Year of manufacture", tx.yearOfManufacture],
      ["Status", STATUS_META[tx.status].label],
      ["Location", tx.currentSiteName],
      ["Feeder", tx.feeder],
      ["Region", tx.region],
      ["Store", tx.currentStore?.name ?? null],
      ["GPS coordinates", tx.currentLat != null ? `${gps(tx.currentLat)}, ${gps(tx.currentLng)}` : null],
      ["Installation date", dmy(tx.commissionDate)],
      ["Warranty expiry", dmy(w.expiresAt)],
    ]));

    content.push(sectionTitle("Health status"));
    content.push({
      margin: [0, 0, 0, 10],
      table: { widths: ["*"], body: [[{
        text: `${HEALTH_STATUS_META[healthStatus.level].emoji} ${HEALTH_STATUS_META[healthStatus.level].label.toUpperCase()} — ${healthStatus.explanation}`,
        bold: true, fontSize: 11, color: HEALTH_STATUS_META[healthStatus.level].colour,
        fillColor: HEALTH_STATUS_META[healthStatus.level].colour + "18", margin: [10, 8, 10, 8],
      }]] },
      layout: "noBorders",
    });
    content.push(detailTable([
      ["Composite health score", `${health.score} / 100 — ${HEALTH_BAND_META[health.band].label}`],
      ["Electrical stress", priorityRow?.electrical != null ? `${priorityRow.electrical} / 100` : "not measured"],
      ["Physical condition", priorityRow?.physical != null ? `${priorityRow.physical} / 100` : "not measured"],
    ]));

    content.push(sectionTitle("Service summary"));
    content.push(detailTable([
      ["Age", `${serviceSummary.age.years}y ${serviceSummary.age.months}m ${serviceSummary.age.days}d (from ${serviceSummary.ageSource})`],
      ["Days in service", serviceSummary.daysInService != null ? String(serviceSummary.daysInService) : "—"],
      ["Days in repair", String(serviceSummary.daysInRepair)],
      ["Days awaiting action", String(serviceSummary.daysAwaitingAction)],
      ["Total events recorded", String(serviceSummary.totalEvents)],
      ["Inspections completed", String(serviceSummary.inspectionsCompleted)],
      ["Tests performed", String(serviceSummary.testsPerformed)],
      ["Faults reported", String(serviceSummary.faultsReported)],
      ["Repairs completed", String(serviceSummary.repairsCompleted)],
      ["Warranty claims filed", String(serviceSummary.warrantyClaimsFiled)],
      ["Purchase cost (indicative)", formatKes(serviceSummary.purchaseCostKes)],
      ["Repair cost to date", formatKes(serviceSummary.repairCostKes)],
      ["Current loss-of-life cost", serviceSummary.lossOfLifeCostKesPerHour != null ? `${formatKes(serviceSummary.lossOfLifeCostKesPerHour)}/hour` : "no load data yet"],
    ]));

    // === Complete life history ===============================================
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Complete life history"));
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

      content.push({
        unbreakable: true,
        margin: [0, 0, 0, 8],
        table: {
          widths: [3, "*"],
          body: [[
            { text: "", fillColor: KPLC_GREEN },
            {
              stack: [
                { columns: [
                  { text: meta.label, bold: true, color: "#0a1a4f", fontSize: 10, width: "*" },
                  { text: dmy(e.occurredAt), fontSize: 8, color: "#5b6480", width: "auto" },
                ] },
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

    // === Test history with trends ============================================
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
    const chronologicalTests = [...tx.tests].reverse();
    const bdvTrend = trend(chronologicalTests.map((t) => t.oilBdvKv).reverse());
    const irhvTrend = trend(chronologicalTests.map((t) => t.insulationResistanceHvMohm).reverse());
    const irlvTrend = trend(chronologicalTests.map((t) => t.insulationResistanceLvMohm).reverse());
    const wrhvTrend = trend(chronologicalTests.map((t) => t.windingResistanceHvOhm).reverse());
    content.push({
      margin: [0, 12, 0, 0],
      stack: [
        { text: "Trends", style: "h2" },
        { text: bdvTrend ? `Oil BDV: ${bdvTrend}` : "Oil BDV: no readings", fontSize: 9, margin: [0, 4, 0, 0] },
        { text: irhvTrend ? `Insulation resistance HV: ${irhvTrend}` : "Insulation resistance HV: no readings", fontSize: 9 },
        { text: irlvTrend ? `Insulation resistance LV: ${irlvTrend}` : "Insulation resistance LV: no readings", fontSize: 9 },
        { text: wrhvTrend ? `Winding resistance HV: ${wrhvTrend}` : "Winding resistance HV: no readings", fontSize: 9 },
      ],
    });

    // === Load analysis summary (EMDis) =======================================
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Load analysis summary"));
    if (latestHour) {
      content.push(detailTable([
        ["EMDis datasets linked", String(emdisAgg._count._all)],
        ["Total load readings", (emdisAgg._sum.readingCount ?? 0).toLocaleString()],
        ["Latest hour recorded", dmy(latestHour.hourStart)],
        ["Peak phase % of rated", latestHour.maxPhasePctRated != null ? `${latestHour.maxPhasePctRated.toFixed(0)}%` : "—"],
        ["Max current unbalance", latestHour.maxUnbalancePct != null ? `${latestHour.maxUnbalancePct.toFixed(0)}%` : "—"],
        ["Max THD", latestHour.maxThdPct != null ? `${latestHour.maxThdPct.toFixed(1)}%` : "—"],
        ["Minutes over 100% rated (last hour)", String(latestHour.minutesOver100Pct)],
      ]));
    } else {
      content.push({ text: "No EMDis load telemetry is linked to this transformer yet.", style: "muted" });
    }

    // === Inspection history (KYN) =============================================
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Inspection history (KYN register)"));
    if (inspections.length) {
      content.push(dataTable(
        ["Date", "Structure", "HV earth", "Neutral earth", "Fuse carriers", "Loading"],
        inspections.map((i) => [
          dmy(i.inspectedOn), i.structure ?? "—",
          i.hvEarthState === "OPEN_CIRCUIT" ? "OPEN" : i.hvEarthOhm != null ? `${i.hvEarthOhm} Ω` : "—",
          i.neutralEarthState === "OPEN_CIRCUIT" ? "OPEN" : i.neutralEarthOhm != null ? `${i.neutralEarthOhm} Ω` : "—",
          i.fuseCarriers ?? "—",
          i.loadingOk === false ? "NOT OK" : i.loadingOk === true ? "OK" : "—",
        ]),
      ));
    } else {
      content.push({ text: "No KYN inspection records are linked to this transformer yet.", style: "muted" });
    }

    // === Warranty timeline + claims ===========================================
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

    // === Photo gallery ========================================================
    const withPhotos = tx.events.filter((e) => e.photoUrls.length > 0);
    const flat = withPhotos.flatMap((e) => e.photoUrls.map((url) => ({ url, caption: `${EVENT_META[e.type].label} — ${dmy(e.occurredAt)}` })));
    const embedded = await embedPhotos(flat.map((f) => f.url));
    if (embedded.length) {
      content.push({ text: "", pageBreak: "before" });
      content.push(sectionTitle("Photographs"));
      for (let i = 0; i < embedded.length; i += 2) {
        const pair = embedded.slice(i, i + 2);
        content.push({
          columns: pair.map((p) => {
            const caption = flat.find((f) => f.url === p.url)?.caption ?? "";
            return { width: "50%", stack: [{ image: p.data, fit: [230, 165] }, { text: caption, style: "muted", margin: [0, 3, 0, 0] }] };
          }),
          columnGap: 12, margin: [0, 0, 0, 14], unbreakable: true,
        });
      }
    }

    // === Chain verification + audit log summary ==============================
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Custody chain verification"));
    content.push({
      margin: [0, 0, 0, 10],
      table: { widths: ["*"], body: [[{
        text: chain.valid ? `Chain verified — ${chain.checked} events, unbroken.` : `CHAIN BROKEN — ${chain.reason ?? "a hash does not match its contents."}`,
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
      tx.events.map((e, i) => [i + 1, EVENT_META[e.type].label, dmy(e.occurredAt), e.prevHash ? `…${e.prevHash.slice(-12)}` : "genesis", `…${e.hash.slice(-12)}`]),
      [20, "auto", "auto", "*", "*"],
    ));

    // === Manufacturer comparison ==============================================
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Manufacturer comparison"));
    const mRow = manufacturerRows.find((m) => m.id === tx.manufacturerId);
    const avgFailureRate = fleetAverage(manufacturerRows, "failureRatePct");
    if (mRow) {
      content.push(detailTable([
        ["Manufacturer", mRow.name],
        ["Units in fleet", String(mRow.unitsInFleet)],
        ["Failure rate", mRow.failureRatePct != null ? `${mRow.failureRatePct.toFixed(1)}%` : "—"],
        ["Fleet average failure rate", avgFailureRate != null ? `${avgFailureRate.toFixed(1)}%` : "—"],
        ["Avg service life", mRow.avgServiceLifeYears != null ? `${mRow.avgServiceLifeYears.toFixed(1)} years` : "—"],
        ["Warranty claims filed", String(mRow.warrantyClaimsFiled)],
        ["Claims settled", String(mRow.claimsSettled)],
        ["Claims disputed", String(mRow.claimsDisputed)],
        ["Most common fault", mRow.mostCommonFault ?? "—"],
      ]));
    } else {
      content.push({ text: "No manufacturer performance data available.", style: "muted" });
    }

    const buffer = await buildPdf({
      cover: {
        title: "Full Transformer Dossier",
        headline: label,
        subhead: `${tx.manufacturer.name} · ${tx.ratingKva} kVA · ${STATUS_META[tx.status].label} · ${HEALTH_STATUS_META[healthStatus.level].label}`,
        meta: [
          ["Manufacturer", tx.manufacturer.name],
          ["Rating", `${tx.ratingKva} kVA`],
          ["Status", STATUS_META[tx.status].label],
          ["Health status", `${HEALTH_STATUS_META[healthStatus.level].emoji} ${HEALTH_STATUS_META[healthStatus.level].label}`],
          ["Region", tx.region ?? "—"],
          ["Generated by", `${viewer.name} (${ROLE_LABELS[viewer.role]})`],
          ["Date", new Date().toLocaleString("en-GB")],
        ],
      },
      content,
    });

    return pdf(buffer, `dossier-${label}`);
  } catch (error) {
    return apiError(error);
  }
}
