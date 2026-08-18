import { NextResponse } from "next/server";
import type { Content } from "pdfmake/interfaces";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { pdf } from "@/lib/report-response";
import { buildPdf, dataTable, detailTable, sectionTitle, KPLC_NAVY } from "@/lib/pdf";
import { computeThermal, LIMIT_HOTSPOT_C, LIMIT_TOP_OIL_C } from "@/lib/transformer-thermal";
import { ROLE_LABELS } from "@/lib/format";

/**
 * GET /api/pdf/control-report?dataset=<id> — the 24-hour monitoring report.
 *
 * Recomputes the whole day server-side from the stored readings rather than
 * taking numbers from the browser: the report has to stand on its own, and a
 * client-supplied figure is not evidence.
 *
 * `dataset` is honoured. It used to be accepted and ignored — the route always
 * used the ACTIVE dataset — so choosing an older upload and exporting it handed
 * you a different day's report with nothing on the page saying so. A report
 * that silently answers a question you did not ask is worse than an error.
 */

const AMBIENT_C = 28;

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");

    const requestedId = new URL(request.url).searchParams.get("dataset");

    const dataset = requestedId
      ? await prisma.meterDataset.findUnique({ where: { id: requestedId } })
      : await prisma.meterDataset.findFirst({ where: { active: true } });

    if (!dataset) {
      return NextResponse.json(
        {
          error: requestedId
            ? "That meter dataset no longer exists. It may have been deleted since the page was loaded."
            : "No meter data loaded.",
        },
        { status: 404 },
      );
    }

    // Aggregate per interval in SQL — pulling 96,000 rows into Node to sum them
    // would be slow and pointless.
    const grouped = await prisma.meterReading.groupBy({
      by: ["intervalIndex"],
      where: { datasetId: dataset.id },
      _sum: { power: true },
      _avg: { voltage: true, powerFactor: true },
      _min: { voltage: true, timestamp: true },
      _count: { _all: true },
      orderBy: { intervalIndex: "asc" },
    });

    const rows = grouped.map((g) => {
      const kw = g._sum.power ?? 0;
      const pf = g._avg.powerFactor ?? 0.95;
      const kva = pf > 0 ? kw / pf : kw;
      const t = computeThermal({ loadKva: kva, ratingKva: dataset.ratingKva, ambientC: AMBIENT_C, powerFactor: pf });
      return {
        interval: g.intervalIndex,
        label: g._min.timestamp ? g._min.timestamp.toISOString().slice(11, 16) : `#${g.intervalIndex}`,
        kw, kva, pf,
        avgV: g._avg.voltage ?? 0,
        minV: g._min.voltage ?? 0,
        meters: g._count._all,
        thermal: t,
      };
    });

    // A dataset row can exist with no readings behind it — an upload that
    // parsed to zero rows leaves exactly that. Without this guard `rows[0]` is
    // undefined, the reduce returns undefined, and the first `peak.kva` below
    // throws, which surfaced as a bare HTTP 500.
    //
    // The honest answer is the same 404 this route already gives when there is
    // no dataset at all, worded so an operator can tell the two apart. A
    // 24-hour monitoring report with nothing measured is not a document worth
    // handing anybody.
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: `"${dataset.name}" has no meter readings, so there is nothing to report on. Re-upload the interval file — the last upload parsed to zero rows.`,
        },
        { status: 404 },
      );
    }

    // Safe: rows.length > 0 is established above.
    const peak = rows.reduce((a, b) => (b.kva > a.kva ? b : a), rows[0]);
    const overloads = rows.filter((r) => r.kva > dataset.ratingKva);
    const hotspotBreaches = rows.filter((r) => r.thermal.hotspotC > LIMIT_HOTSPOT_C);
    const lowVoltage = rows.filter((r) => r.avgV > 0 && r.avgV < 220);
    // Insulation life consumed: the ageing rate integrated over the day.
    const lifeHours = rows.reduce((s, r) => s + r.thermal.ageingRate * 0.25, 0);
    const totalKwh = rows.reduce((s, r) => s + r.kw * 0.25, 0);
    const lossKwh = rows.reduce((s, r) => s + (r.thermal.totalLossesW / 1000) * 0.25, 0);

    const content: Content[] = [];

    content.push(sectionTitle("Monitoring summary"));
    content.push(detailTable([
      ["Transformer", dataset.transformerRef ?? "—"],
      ["Nameplate rating", `${dataset.ratingKva} kVA`],
      ["Meters monitored", dataset.meterCount.toLocaleString()],
      ["Intervals analysed", `${rows.length} × 15 minutes`],
      ["Peak load", `${peak.kva.toFixed(1)} kVA (${((peak.kva / dataset.ratingKva) * 100).toFixed(1)} %) at ${peak.label}`],
      ["Peak hot-spot", `${peak.thermal.hotspotC.toFixed(1)} °C`],
      ["Energy delivered", `${totalKwh.toFixed(0)} kWh`],
      ["Losses", `${lossKwh.toFixed(1)} kWh (${totalKwh > 0 ? ((lossKwh / totalKwh) * 100).toFixed(2) : "0"} % of throughput)`],
      ["Insulation life consumed", `${lifeHours.toFixed(2)} equivalent hours over 24 real hours`],
      ["Intervals above rating", String(overloads.length)],
      ["Intervals above 120 °C hot-spot", String(hotspotBreaches.length)],
      ["Intervals below 220 V average", String(lowVoltage.length)],
    ]));

    content.push({
      margin: [0, 12, 0, 0],
      text: lifeHours > 24
        ? `Over this day the transformer consumed ${lifeHours.toFixed(1)} hours of insulation life in 24 hours — ageing ${(lifeHours / 24).toFixed(2)}× faster than normal. Sustained, that shortens service life proportionally.`
        : `Insulation ageing was ${(lifeHours / 24).toFixed(2)}× normal over the day, which is within expectation for this loading.`,
      fontSize: 9,
    });

    content.push(sectionTitle("Method"));
    content.push({
      text: "Loading is computed as apparent power S = P / cos φ, because the nameplate rating is in kVA. Top-oil and hot-spot temperatures follow the IEC 60076-7 steady-state model for ONAN oil-immersed transformers, with ambient taken as 28 °C. Relative insulation ageing uses V = 2^((Θh − 98)/6). Loss figures use typical no-load and load losses for a unit of this rating; substitute the manufacturer's test certificate values before using these numbers for an operational decision.",
      fontSize: 9,
    });

    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Interval detail"));
    content.push(dataTable(
      ["Time", "kW", "kVA", "% rating", "PF", "Avg V", "Min V", "Top oil °C", "Hot-spot °C", "Ageing ×"],
      rows.map((r) => [
        r.label, r.kw.toFixed(1), r.kva.toFixed(1),
        `${((r.kva / dataset.ratingKva) * 100).toFixed(0)}%`,
        r.pf.toFixed(2), r.avgV.toFixed(0), r.minV.toFixed(0),
        r.thermal.topOilC.toFixed(0), r.thermal.hotspotC.toFixed(0), r.thermal.ageingRate.toFixed(2),
      ]),
      ["auto", "auto", "auto", "auto", "auto", "auto", "auto", "auto", "auto", "auto"],
      (row) => {
        const pct = parseFloat(String(row[3]));
        return pct > 100 ? "#fee2e2" : pct > 95 ? "#fef3c7" : undefined;
      },
    ));

    const buffer = await buildPdf({
      landscape: true,
      cover: {
        title: "24-Hour Monitoring Report",
        headline: dataset.transformerRef ?? dataset.name,
        subhead: `${dataset.ratingKva} kVA · ${dataset.meterCount.toLocaleString()} meters`,
        meta: [
          ["Peak load", `${peak.kva.toFixed(0)} kVA at ${peak.label}`],
          ["Overload intervals", String(overloads.length)],
          ["Generated by", `${user.name} (${ROLE_LABELS[user.role]})`],
          ["Date", new Date().toLocaleString("en-GB")],
        ],
      },
      content,
    });

    return pdf(buffer, `control-report-${(dataset.transformerRef ?? "transformer").replace(/\s+/g, "-")}`);
  } catch (error) {
    return apiError(error);
  }
}
