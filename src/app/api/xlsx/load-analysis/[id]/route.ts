import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { xlsx } from "@/lib/report-response";
import { analyseDatasetById } from "@/lib/emdis-read";
import { computePhaseDistribution } from "@/lib/phase-distribution";
import { PHASE_META, NEUTRAL_META, type PhaseKey } from "@/lib/phase-colors";

/**
 * GET /api/xlsx/load-analysis/:id — the Load Analysis screen as a workbook.
 *
 * Built directly with ExcelJS rather than the shared `toXlsx` column helper:
 * the shared helper's cell-tone palette is status colours (faulty/ok/overdue),
 * and this report needs the KPLC R-Y-B phase identity instead, which is a
 * different colour dimension entirely.
 */

const KPLC_NAVY = "FF0A1A4F";
const KPLC_GREEN = "FF006837";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const { id } = await params;

    const full = await analyseDatasetById(id);
    if (!full) return NextResponse.json({ error: "Dataset not found." }, { status: 404 });

    const { dataset, transformer, analysis: a, thermalByPhase, prognosis, money, balance } = full;
    const label = transformer?.gNumber ? `G-${transformer.gNumber}` : (dataset.substationCode ?? dataset.name);

    const worstCurrents = {
      l1: balance.present.find((p) => p.phase === "L1")?.amps ?? 0,
      l2: balance.present.find((p) => p.phase === "L2")?.amps ?? 0,
      l3: balance.present.find((p) => p.phase === "L3")?.amps ?? 0,
    };
    const distribution = computePhaseDistribution({
      currents: worstCurrents,
      ratedPhaseA: a.ratedPhaseA,
      ratingKva: a.ratingKva,
    });
    const heaviest = distribution.heaviest;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Transformer DNA";
    workbook.created = new Date();

    // --- Sheet 1: Phase distribution ---------------------------------------
    const sheet = workbook.addWorksheet("Phase Distribution", {
      views: [{ state: "frozen", ySplit: 5 }],
    });

    const cols = 7;
    sheet.mergeCells(1, 1, 1, cols);
    const title = sheet.getCell(1, 1);
    title.value = `Load Analysis — ${label}`;
    title.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPLC_NAVY } };
    title.alignment = { vertical: "middle", indent: 1 };
    sheet.getRow(1).height = 28;

    sheet.mergeCells(2, 1, 2, cols);
    const sub = sheet.getCell(2, 1);
    sub.value = `${a.ratingKva} kVA · rated phase current ${a.ratedPhaseA.toFixed(0)} A · ${distribution.estimatedTotalCustomers} customers estimated`;
    sub.font = { name: "Calibri", size: 10, color: { argb: "FF5B6480" } };
    sheet.getRow(2).height = 18;

    sheet.mergeCells(3, 1, 3, cols);
    const alert = sheet.getCell(3, 1);
    const alertMeta = PHASE_META[heaviest.phase];
    alert.value =
      heaviest.pctRated >= 100
        ? `⚠ ${alertMeta.word.toUpperCase()} PHASE (${heaviest.phase}) IS CRITICALLY OVERLOADED — ${heaviest.pctRated.toFixed(0)}% of rated`
        : `No phase is currently overloaded — heaviest is ${alertMeta.label} at ${heaviest.pctRated.toFixed(0)}%`;
    alert.font = { name: "Calibri", size: 11, bold: true, color: { argb: heaviest.pctRated >= 100 ? "FFB91C1C" : KPLC_GREEN } };
    alert.fill = { type: "pattern", pattern: "solid", fgColor: { argb: heaviest.pctRated >= 100 ? "FFFEE2E2" : "FFE8F5EE" } };
    sheet.getRow(3).height = 20;

    sheet.getRow(4).height = 6;

    const headers = ["Phase", "Amps", "% of Rated", "Status", "Est. Customers", "Avg A / Customer", "Recommendation"];
    const headerRow = sheet.getRow(5);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPLC_GREEN } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    headerRow.height = 24;
    sheet.columns = [
      { width: 20 }, { width: 12 }, { width: 12 }, { width: 24 }, { width: 16 }, { width: 16 }, { width: 44 },
    ];

    for (const row of distribution.phases) {
      const meta = PHASE_META[row.phase];
      const r = sheet.addRow([
        meta.label, Math.round(row.amps), `${row.pctRated.toFixed(0)}%`, `${row.status.label} ${row.status.emoji}`,
        row.estimatedCustomers, Number(row.avgAmpsPerCustomer.toFixed(1)), row.recommendation,
      ]);
      const isHeaviest = row.phase === heaviest.phase && heaviest.pctRated >= 100;
      r.eachCell((cell, colNumber) => {
        cell.font = { name: "Calibri", size: 10, bold: isHeaviest, color: isHeaviest ? { argb: "FFB91C1C" } : undefined };
        if (colNumber === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isHeaviest ? "FFFEE2E2" : withAlpha(meta.colour) } };
        } else if (isHeaviest) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        }
        cell.border = { bottom: { style: "hair", color: { argb: "FFE2E5EB" } } };
      });
    }

    // Neutral row.
    const nRow = sheet.addRow([
      NEUTRAL_META.label, Math.round(a.neutral.medianA), `${a.neutral.medianPctRated.toFixed(0)}%`,
      a.neutral.medianPctRated >= 50 ? "Severe imbalance / harmonics" : "Within expectation",
      "", "", "Expected near zero for a balanced three-phase load.",
    ]);
    nRow.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF5B6480" } };

    sheet.addRow([]);

    // --- Before / after balancing -------------------------------------------
    const beforeAfterHeader = sheet.addRow(["Phase", "Now (A)", "Now (%)", "After balancing (A)", "After (%)"]);
    beforeAfterHeader.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    beforeAfterHeader.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPLC_NAVY } }; });
    for (const p of balance.present) {
      const meta = PHASE_META[p.phase as PhaseKey];
      const row = sheet.addRow([
        meta.label, Math.round(p.amps), `${p.pctRated.toFixed(0)}%`,
        Math.round(balance.targetA), `${balance.targetPctRated.toFixed(0)}%`,
      ]);
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: withAlpha(meta.colour) } };
    }
    sheet.addRow(["Unbalance", `${balance.unbalanceBeforePct.toFixed(0)}%`, "", `<${balance.unbalanceAfterPct.toFixed(0)}%`, ""]);

    sheet.addRow([]);
    const movesHeader = sheet.addRow(["Required moves", "", "", "", ""]);
    movesHeader.font = { name: "Calibri", size: 10, bold: true, color: { argb: KPLC_NAVY } };
    if (balance.moves.length) {
      for (const m of balance.moves) {
        sheet.addRow([`Move ${m.amps} A from ${PHASE_META[m.from].word} Phase → ${PHASE_META[m.to].word} Phase`]);
      }
    } else {
      sheet.addRow([balance.note]);
    }

    sheet.addRow([]);
    const costRow = sheet.addRow(["Cost of current ageing", `KES ${money.currentPerHourKes.toFixed(0)}/hour`, `KES ${money.currentPerYearKes.toFixed(0)}/year`]);
    costRow.font = { name: "Calibri", size: 10, color: { argb: "FFB91C1C" } };
    sheet.addRow(["Hot-spot", `${thermalByPhase.hotspotC.toFixed(0)} °C`, `ageing ${thermalByPhase.ageingRate.toFixed(1)}× normal`]);
    sheet.addRow(["Time to failure at current rate", prognosis.yearsToEndOfLife < 1 ? `${(prognosis.yearsToEndOfLife * 12).toFixed(1)} months` : `${prognosis.yearsToEndOfLife.toFixed(1)} years`]);

    sheet.addRow([]);
    const footer = sheet.addRow([
      `Generated by Transformer DNA | Kenya Power | ${user.name} | ${new Date().toLocaleString("en-GB")}`,
    ]);
    footer.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF5B6480" } };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return xlsx(new Uint8Array(arrayBuffer as ArrayBuffer), `load-analysis-${label}`);
  } catch (error) {
    return apiError(error);
  }
}

/** KPLC identity colour, lightened for a cell fill rather than a solid block. */
function withAlpha(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.75);
  const toHex = (c: number) => c.toString(16).padStart(2, "0").toUpperCase();
  return `FF${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}
