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
    title: "Regional Asset Register",
    body: "Every transformer: status, location, warranty and last test.",
    formats: [
      { label: "CSV", href: "/api/reports/asset-register?format=csv" },
      { label: "XLSX", href: "/api/reports/asset-register?format=xlsx" },
    ],
  },
  {
    title: "Warranty Claim Pack",
    body: "Per manufacturer: units, faults, values and chain hashes. The document you send to claim.",
    formats: [{ label: "XLSX", href: "/api/reports/warranty-pack?format=xlsx" }],
    accent: true,
  },
  {
    title: "Fault Report",
    body: "Every fault, by cause and manufacturer, with GPS.",
    formats: [
      { label: "CSV", href: "/api/reports/fault-report?format=csv" },
      { label: "XLSX", href: "/api/reports/fault-report?format=xlsx" },
    ],
  },
  {
    title: "Dispatch Log",
    body: "Every movement, vehicle, plate and driver.",
    formats: [{ label: "CSV", href: "/api/reports/dispatch-log?format=csv" }],
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
