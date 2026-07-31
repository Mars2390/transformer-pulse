import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Reports" };

/**
 * The report library. Each card links straight to a download endpoint, so a
 * click gives a file — no intermediate "generating…" screen for something that
 * takes under a second.
 */
const REPORTS = [
  {
    title: "Regional Asset Summary (PDF)",
    body: "The boardroom document: executive summary, status chart, region comparison and the full register — branded, paginated and ready to present.",
    formats: [{ label: "PDF", href: "/api/pdf/regional-summary" }],
    accent: true,
  },
  {
    title: "Regional Asset Register",
    body: "The master export — 35 columns: identity, GPS, status, install and inspection dates, test trends, warranty position, health and chain status.",
    formats: [
      { label: "XLSX", href: "/api/reports/asset-register?format=xlsx" },
      { label: "CSV", href: "/api/reports/asset-register?format=csv" },
    ],
  },
  {
    title: "Warranty Claim Pack",
    body: "The document you send to claim. PDF is the cover-letter submission with one page per claim and its chain proof; XLSX is the same data as a workbook.",
    formats: [
      { label: "PDF", href: "/api/pdf/warranty-pack" },
      { label: "XLSX", href: "/api/reports/warranty-pack?format=xlsx" },
    ],
    accent: true,
  },
  {
    title: "Fault Analysis Report",
    body: "Every fault by region and cause, days-in-service, warranty coverage at fault, claim outcome and replacement unit.",
    formats: [
      { label: "XLSX", href: "/api/reports/fault-report?format=xlsx" },
      { label: "CSV", href: "/api/reports/fault-report?format=csv" },
    ],
  },
  {
    title: "Inspection Compliance",
    body: "Every in-field unit, most overdue first, colour-coded OK / Due Soon / Overdue, with the latest oil-BDV trend.",
    formats: [
      { label: "XLSX", href: "/api/reports/inspection-compliance?format=xlsx" },
      { label: "CSV", href: "/api/reports/inspection-compliance?format=csv" },
    ],
  },
  {
    title: "Dispatch & Movement Log",
    body: "Every dispatch paired with its field receipt: vehicle, plate, driver, days in transit.",
    formats: [
      { label: "XLSX", href: "/api/reports/dispatch-log?format=xlsx" },
      { label: "CSV", href: "/api/reports/dispatch-log?format=csv" },
    ],
  },
  {
    title: "Intake Test Register",
    body: "Full IEC test values for every intake test, colour-coded pass/fail.",
    formats: [{ label: "XLSX", href: "/api/reports/intake-tests?format=xlsx" }],
  },
  {
    title: "Engineer Performance",
    body: "Per engineer: installs, inspections and faults this month and year, plus average dispatch-to-install time.",
    formats: [
      { label: "XLSX", href: "/api/reports/engineer-performance?format=xlsx" },
      { label: "CSV", href: "/api/reports/engineer-performance?format=csv" },
    ],
  },
  {
    title: "GPS Location Export",
    body: "A clean coordinate CSV for import into QGIS, Google My Maps or any GIS tool.",
    formats: [{ label: "CSV", href: "/api/reports/locations" }],
  },
  {
    title: "Manufacturer Performance",
    body: "Failure rate, service life, warranty recovery and IR/BDV decline by manufacturer, worst first. The interactive comparison and drill-down live under Manufacturers in the sidebar.",
    formats: [
      { label: "PDF", href: "/api/pdf/manufacturer-performance" },
      { label: "XLSX", href: "/api/reports/manufacturer-performance?format=xlsx" },
    ],
  },
];

export default async function ReportsPage() {
  await requireRole("MANAGER", "ADMIN");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Reports</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Scoped to your region. XLSX exports carry the KPLC header and the custody-chain note.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <div
            key={report.title}
            className={`rounded-2xl border bg-white p-5 ${
              report.accent ? "border-gold/40 ring-1 ring-gold/20" : "border-line"
            }`}
          >
            <h2 className="text-sm font-bold text-navy">{report.title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{report.body}</p>
            <div className="mt-4 flex gap-2">
              {report.formats.map((f) => (
                <a
                  key={f.label}
                  href={f.href}
                  className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                    report.accent
                      ? "bg-gold text-navy-dark hover:bg-gold-dark"
                      : "bg-kplc text-white hover:bg-kplc-light"
                  }`}
                >
                  Download {f.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
