import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { siteUrl } from "@/lib/qr";
import { QrPinSettings } from "@/components/admin/QrPinSettings";

export const metadata: Metadata = { title: "System settings" };
export const dynamic = "force-dynamic";

/**
 * The settings an administrator can change without a deployment.
 *
 * Kept deliberately short. Anything that changes how the lifecycle chain,
 * approvals or scoping behave is NOT here and should not be — those are rules,
 * and a rule that can be edited from a web form by whoever is logged in as
 * admin is a rule the audit trail cannot vouch for.
 */
export default async function AdminSettingsPage() {
  await requireRole("ADMIN");

  const [setting, aiConfigured] = await Promise.all([
    prisma.appSetting.findUnique({
      where: { id: "singleton" },
      include: { updatedBy: { select: { name: true } } },
    }),
    Promise.resolve(Boolean(process.env.OPENROUTER_API_KEY)),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">System settings</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Administrator only. Every change here is written to the audit log with your name against
          it.
        </p>
      </div>

      <QrPinSettings usingDefault={!setting?.qrAccessPinHash} />

      {setting?.updatedAt && (
        <p className="text-[11px] text-ink-soft">
          Last changed {setting.updatedAt.toLocaleString("en-GB")}
          {setting.updatedBy?.name ? ` by ${setting.updatedBy.name}` : ""}.
        </p>
      )}

      {/* --- Read-only environment facts ------------------------------- */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-extrabold text-navy">Environment</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Set on the hosting platform, not here. Shown so a failure is diagnosable from inside the
          app instead of by guesswork.
        </p>

        <dl className="mt-4 space-y-3">
          <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
            <div>
              <dt className="text-sm font-bold text-navy">AI nameplate reading</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                {aiConfigured
                  ? "An OpenRouter key is configured, so the Scan Nameplate button will use the vision model. Readings still land in a form somebody confirms — nothing is saved automatically."
                  : "No OPENROUTER_API_KEY is set, so scanning falls back to on-device OCR. That is a working fallback, not a failure, and receiving has never depended on either."}
              </dd>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                aiConfigured ? "bg-emerald-50 text-emerald-700" : "bg-surface-2 text-ink-soft"
              }`}
            >
              {aiConfigured ? "Configured" : "Not set"}
            </span>
          </div>

          <div>
            <dt className="text-sm font-bold text-navy">QR label address</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-ink-soft">{siteUrl()}/t/…</dd>
            <dd className="mt-1 text-xs leading-relaxed text-ink-soft">
              Every printed label points at this address. Changing it after labels are in the field
              breaks those labels, so it is set from NEXT_PUBLIC_SITE_URL on the platform rather
              than being editable here.
            </dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/qr-codes"
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-navy"
        >
          Print QR labels →
        </Link>
        <Link
          href="/admin/audit"
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-navy"
        >
          Audit log →
        </Link>
      </div>
    </div>
  );
}
