import type { Column, Content } from "pdfmake/interfaces";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { pdf } from "@/lib/report-response";
import { buildPdf, dataTable, sectionTitle, KPLC_NAVY } from "@/lib/pdf";
import { loadEnriched, reportScope, dmy, INSPECTION_OVERDUE } from "@/lib/report-data";
import { ROLE_LABELS, STATUS_META, formatKes } from "@/lib/format";

/** GET /api/pdf/regional-summary — the boardroom overview of a region. */

const STATUS_COLOUR: Record<string, string> = {
  IN_FIELD: "#0e8a4f", FAULTY: "#c02626", IN_STORE: "#1e40af",
  IN_TRANSIT: "#7c3aed", RETURNED: "#7b8383", SCRAPPED: "#7b8383",
};

export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const scope = reportScope(user.role, user.region);
    const { rows, verified, total } = await loadEnriched(scope);

    const claims = await prisma.warrantyClaim.findMany({
      where: { transformer: scope, status: { in: ["OPEN", "SUBMITTED", "APPROVED"] } },
      select: { claimValueKes: true },
    });
    const recoverable = claims.reduce((s, c) => s + Number(c.claimValueKes ?? 0), 0);

    const alerts = await prisma.alert.findMany({
      where: { acknowledged: false, ...(user.role === "MANAGER" && user.region ? { region: user.region } : {}) },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: { transformer: { select: { gNumber: true, serialNumber: true } } },
    });

    // --- Aggregates ---------------------------------------------------------
    const byStatus = new Map<string, number>();
    for (const r of rows) byStatus.set(r.tx.status, (byStatus.get(r.tx.status) ?? 0) + 1);

    const inField = rows.filter((r) => r.tx.status === "IN_FIELD");
    const overdue = inField.filter((r) => (r.daysSinceInspection ?? 1e9) > INSPECTION_OVERDUE).length;
    const compliantPct = inField.length ? Math.round(((inField.length - overdue) / inField.length) * 100) : 100;
    const health = { good: 0, watch: 0, critical: 0 };
    for (const r of rows) {
      if (r.healthLabel === "Good") health.good++;
      else if (r.healthLabel === "Critical" || r.healthLabel === "At risk") health.critical++;
      else health.watch++;
    }

    const content: Content[] = [];

    // --- Executive summary --------------------------------------------------
    content.push(sectionTitle("Executive summary"));
    content.push({
      columns: [
        tile("Total transformers", String(total)),
        tile("In field", String(byStatus.get("IN_FIELD") ?? 0)),
        tile("Faulty", String(byStatus.get("FAULTY") ?? 0)),
        tile("Recoverable", formatKes(recoverable)),
      ],
      columnGap: 10,
      margin: [0, 0, 0, 14],
    });

    content.push({
      stack: [
        { text: `Inspection compliance: ${compliantPct}% compliant, ${overdue} overdue of ${inField.length} in field.`, fontSize: 9 },
        { text: `Health: ${health.good} good, ${health.watch} watch, ${health.critical} at risk or critical.`, fontSize: 9 },
        { text: `Custody chains: ${verified} of ${total} verified and unbroken.`, fontSize: 9 },
        { text: `Open warranty claims: ${claims.length}, totalling ${formatKes(recoverable)}.`, fontSize: 9 },
      ],
      margin: [0, 0, 0, 6],
    });

    content.push({ text: "Key actions required", style: "h2", margin: [0, 12, 0, 6] });
    if (alerts.length === 0) {
      content.push({ text: "No outstanding alerts. Nothing requires attention.", style: "muted" });
    } else {
      content.push({
        ul: alerts.map((a) => `${a.severity}: ${a.message}`),
        fontSize: 9,
      });
    }

    // --- Status breakdown with a drawn bar chart ---------------------------
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Status breakdown"));

    const maxCount = Math.max(1, ...byStatus.values());
    const bars: Content[] = [...byStatus.entries()].map(([status, count]) => ({
      columns: [
        { text: STATUS_META[status as keyof typeof STATUS_META].label, width: 80, fontSize: 9 },
        {
          width: 300,
          // A drawn rectangle, not an image: it stays crisp at any zoom and
          // costs nothing to embed.
          canvas: [{
            type: "rect", x: 0, y: 2, w: Math.max(2, (count / maxCount) * 300), h: 12,
            color: STATUS_COLOUR[status] ?? "#7b8383",
          }],
        },
        { text: `${count}  (${Math.round((count / (total || 1)) * 100)}%)`, width: "auto", fontSize: 9, bold: true },
      ],
      columnGap: 10,
      margin: [0, 0, 0, 6],
    }));
    content.push(...bars);

    content.push({ margin: [0, 14, 0, 0], ...dataTable(
      ["Status", "Count", "Percentage"],
      [...byStatus.entries()].map(([s, c]) => [
        STATUS_META[s as keyof typeof STATUS_META].label, c, `${Math.round((c / (total || 1)) * 100)}%`,
      ]),
      ["*", "auto", "auto"],
    ) });

    // --- Region comparison --------------------------------------------------
    const byRegion = new Map<string, { total: number; faulty: number; field: number }>();
    for (const r of rows) {
      const key = r.tx.region ?? "Unassigned";
      const e = byRegion.get(key) ?? { total: 0, faulty: 0, field: 0 };
      e.total++;
      if (r.tx.status === "FAULTY") e.faulty++;
      if (r.tx.status === "IN_FIELD") e.field++;
      byRegion.set(key, e);
    }
    if (byRegion.size > 1) {
      content.push(sectionTitle("Region comparison"));
      content.push(dataTable(
        ["Region", "Total", "In field", "Faulty", "Healthy %"],
        [...byRegion.entries()]
          .map(([name, s]) => ({ name, ...s, pct: s.field + s.faulty > 0 ? Math.round((s.field / (s.field + s.faulty)) * 100) : 100 }))
          .sort((a, b) => b.pct - a.pct)
          .map((r) => [r.name, r.total, r.field, r.faulty, `${r.pct}%`]),
        ["*", "auto", "auto", "auto", "auto"],
      ));
    }

    // --- Full list ----------------------------------------------------------
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle(`Transformer register (${total})`));

    // Faulty first, then overdue inspections, then the rest.
    const priority = (r: (typeof rows)[number]) =>
      r.tx.status === "FAULTY" ? 0 : (r.daysSinceInspection ?? 0) > INSPECTION_OVERDUE ? 1 : 2;
    const sorted = [...rows].sort((a, b) => priority(a) - priority(b) || (b.daysSinceInspection ?? 0) - (a.daysSinceInspection ?? 0));

    content.push(dataTable(
      ["G-Number", "Serial", "Manufacturer", "kVA", "Status", "Location", "Last inspection", "Health"],
      sorted.map((r) => [
        r.tx.gNumber ?? "—", r.tx.serialNumber, r.tx.manufacturer.name, r.tx.ratingKva,
        STATUS_META[r.tx.status].label, r.tx.currentSiteName ?? "—",
        dmy(r.lastInspectionDate), r.healthLabel,
      ]),
      ["auto", "auto", "*", 28, "auto", "*", "auto", "auto"],
      (row) => (row[4] === "Faulty" ? "#fee2e2" : undefined),
    ));

    const buffer = await buildPdf({
      landscape: true,
      cover: {
        title: "Regional Asset Summary",
        headline: user.region ?? "All regions",
        subhead: `${total} transformers`,
        meta: [
          ["Generated by", `${user.name} (${ROLE_LABELS[user.role]})`],
          ["Date", new Date().toLocaleString("en-GB")],
          ["Chains verified", `${verified} of ${total}`],
          ["Recoverable", formatKes(recoverable)],
        ],
      },
      content,
    });

    return pdf(buffer, `regional-asset-summary-${(user.region ?? "all").replace(/\s+/g, "-")}`);
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
    margin: [0, 0, 0, 0],
  };
}
