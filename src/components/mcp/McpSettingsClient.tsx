"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { formatDateTime, formatRelative, ROLE_LABELS } from "@/lib/format";

type Settings = {
  enabled: boolean;
  rateLimitPerHour: number;
  managerEnabled: boolean;
  storeKeeperEnabled: boolean;
  fieldEngineerEnabled: boolean;
};

type TokenRow = {
  id: string;
  kind: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revoked: boolean;
};

type LogRow = {
  id: string;
  user: string;
  tool: string;
  success: boolean;
  errorMessage: string | null;
  authMethod: string | null;
  occurredAt: string;
};

export function McpSettingsClient({
  role,
  settings: initialSettings,
  myTokens: initialTokens,
  accessLog,
}: {
  role: Role;
  settings: Settings;
  myTokens: TokenRow[];
  accessLog: LogRow[];
}) {
  const router = useRouter();
  const isAdmin = role === "ADMIN";
  const [settings, setSettings] = useState(initialSettings);
  const [draft, setDraft] = useState(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [tokens, setTokens] = useState(initialTokens);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [tokenLabel, setTokenLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; message: string } | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${origin}/api/mcp`;
  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        "transformer-pulse": {
          command: "npx",
          args: ["tsx", "mcp-server.ts"],
          cwd: "/absolute/path/to/transformer-pulse",
        },
      },
    },
    null,
    2,
  );

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`${what} copied.`);
      setTimeout(() => setCopyMsg(null), 2500);
    } catch {
      setCopyMsg("Couldn't copy — select and copy manually.");
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    setError(null);
    const res = await fetch("/api/mcp/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => ({}));
    setSavingSettings(false);
    if (!res.ok) { setError(data.error ?? "Couldn't save settings."); return; }
    setSettings(draft);
    router.refresh();
  }

  async function generateToken() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/mcp/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: tokenLabel || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Couldn't generate a token."); return; }
    setFreshToken(data.token);
    setTokenLabel("");
    const list = await fetch("/api/mcp/tokens").then((r) => r.json()).catch(() => null);
    if (list?.tokens) setTokens(list.tokens);
  }

  async function revokeToken(id: string) {
    setBusy(true);
    await fetch(`/api/mcp/tokens/${id}`, { method: "DELETE" });
    setBusy(false);
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, revoked: true } : t)));
  }

  async function testConnection() {
    setTestResult(null);
    const res = await fetch("/api/mcp/test");
    const data = await res.json().catch(() => ({ connected: false, message: "Request failed." }));
    setTestResult(data);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy">⚙️ MCP Settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Lets Claude answer questions about the fleet directly — health, load, defects, warranty — over a
            small set of read-only tools. Nothing here can create, change, or delete anything.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold ${
            settings.enabled ? "bg-kplc/10 text-kplc" : "bg-red-100 text-red-700"
          }`}
        >
          {settings.enabled ? "🟢 Connected" : "🔴 Disconnected"}
        </span>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</p>}
      {copyMsg && <p className="text-xs font-semibold text-kplc">{copyMsg}</p>}

      {/* --- Global controls ------------------------------------------------ */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy">Global controls</h2>
          {!isAdmin && <span className="text-[11px] font-semibold text-ink-soft">Only an admin can change these</span>}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Toggle
            label="MCP enabled"
            checked={draft.enabled}
            disabled={!isAdmin}
            onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
          />
          <label className="block">
            <span className="text-xs font-bold text-navy">Rate limit (queries/hour)</span>
            <input
              type="number"
              min={1}
              value={draft.rateLimitPerHour}
              disabled={!isAdmin}
              onChange={(e) => setDraft((d) => ({ ...d, rateLimitPerHour: Number(e.target.value) }))}
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-kplc disabled:bg-surface-2 disabled:text-ink-soft"
            />
          </label>
          <Toggle
            label={`Manager access (${ROLE_LABELS.MANAGER})`}
            checked={draft.managerEnabled}
            disabled={!isAdmin}
            onChange={(v) => setDraft((d) => ({ ...d, managerEnabled: v }))}
          />
          <Toggle
            label={`Store Keeper access (${ROLE_LABELS.STORE_KEEPER})`}
            checked={draft.storeKeeperEnabled}
            disabled={!isAdmin}
            onChange={(v) => setDraft((d) => ({ ...d, storeKeeperEnabled: v }))}
          />
          <Toggle
            label={`Field Engineer access (${ROLE_LABELS.FIELD_ENGINEER})`}
            checked={draft.fieldEngineerEnabled}
            disabled={!isAdmin}
            onChange={(v) => setDraft((d) => ({ ...d, fieldEngineerEnabled: v }))}
          />
        </div>

        {isAdmin && (
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="mt-4 rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark disabled:opacity-50"
          >
            {savingSettings ? "Saving…" : "Save settings"}
          </button>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-ink-soft">
          Admin access is never gated here — whoever can turn MCP off must always be able to turn it back on.
        </p>
      </div>

      {/* --- Connection info -------------------------------------------------- */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-navy">Connect Claude</h2>

        <div className="mt-3">
          <p className="text-xs font-bold text-navy">Remote (recommended) — claude.ai or Claude Desktop</p>
          <p className="mt-1 text-xs text-ink-soft">
            Settings → Connectors → Add custom connector, then paste this URL. Claude opens your browser to sign
            in with your existing Transformer Pulse account.
          </p>
          <div className="mt-2 flex gap-2">
            <input readOnly value={mcpUrl} className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-navy" />
            <button onClick={() => copy(mcpUrl, "URL")} className="shrink-0 rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-navy hover:border-kplc">
              Copy URL
            </button>
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-bold text-navy">Local (stdio) — Claude Desktop, running this repo directly</p>
          <p className="mt-1 text-xs text-ink-soft">
            Add to <code className="rounded bg-surface-2 px-1">claude_desktop_config.json</code>. Replace{" "}
            <code className="rounded bg-surface-2 px-1">cwd</code> with this project&apos;s absolute path on your machine.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-navy px-3 py-2.5 text-[11px] leading-relaxed text-white">{stdioConfig}</pre>
          <button onClick={() => copy(stdioConfig, "Config")} className="mt-2 rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-navy hover:border-kplc">
            Copy Config
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
          <button onClick={testConnection} className="rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-light">
            Test Connection
          </button>
          {testResult && (
            <span className={`text-xs font-semibold ${testResult.connected ? "text-kplc" : "text-red-700"}`}>
              {testResult.connected ? "✅" : "⚠️"} {testResult.message}
            </span>
          )}
        </div>
      </div>

      {/* --- My tokens --------------------------------------------------------- */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-navy">My API keys</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Only needed for a client that can&apos;t do the browser sign-in flow. Generated once, shown once — revoke
          and generate a new one if you lose it.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={tokenLabel}
            onChange={(e) => setTokenLabel(e.target.value)}
            placeholder="Label (optional) — e.g. my laptop"
            className="flex-1 rounded-lg border border-line px-3 py-2 text-xs outline-none focus:border-kplc"
          />
          <button onClick={generateToken} disabled={busy} className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark disabled:opacity-50">
            Generate new key
          </button>
        </div>

        {freshToken && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-bold text-amber-900">Copy this now — it won&apos;t be shown again.</p>
            <div className="mt-1.5 flex gap-2">
              <input readOnly value={freshToken} className="flex-1 rounded-lg border border-line bg-white px-2 py-1.5 font-mono text-[11px] text-navy" />
              <button onClick={() => copy(freshToken, "API key")} className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[11px] font-bold text-navy">
                Copy
              </button>
            </div>
          </div>
        )}

        <ul className="mt-4 divide-y divide-line">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-navy">
                  {t.label ?? "Untitled key"}{" "}
                  <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">{t.kind}</span>
                </p>
                <p className="text-[11px] text-ink-soft">
                  Created {formatRelative(t.createdAt)} · last used {t.lastUsedAt ? formatRelative(t.lastUsedAt) : "never"} · expires{" "}
                  {formatDateTime(t.expiresAt)}
                </p>
              </div>
              {t.revoked ? (
                <span className="shrink-0 text-[11px] font-bold text-ink-soft">Revoked</span>
              ) : (
                <button onClick={() => revokeToken(t.id)} disabled={busy} className="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-50">
                  Revoke
                </button>
              )}
            </li>
          ))}
          {tokens.length === 0 && <li className="py-4 text-xs text-ink-soft">No API keys generated yet.</li>}
        </ul>
      </div>

      {/* --- Access log ------------------------------------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-navy">Access log {isAdmin ? "— everyone" : "— you"}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
              <tr>
                <th className="px-4 py-2">When</th>
                {isAdmin && <th className="px-4 py-2">Who</th>}
                <th className="px-4 py-2">Tool</th>
                <th className="px-4 py-2">Auth</th>
                <th className="px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {accessLog.map((e) => (
                <tr key={e.id} className={!e.success ? "bg-red-50/40" : undefined}>
                  <td className="px-4 py-2 text-ink-soft">{formatDateTime(e.occurredAt)}</td>
                  {isAdmin && <td className="px-4 py-2 text-navy">{e.user}</td>}
                  <td className="px-4 py-2 font-mono text-navy">{e.tool}</td>
                  <td className="px-4 py-2 text-ink-soft">{e.authMethod ?? "—"}</td>
                  <td className="px-4 py-2">
                    {e.success ? (
                      <span className="font-bold text-kplc">OK</span>
                    ) : (
                      <span className="font-bold text-red-700" title={e.errorMessage ?? undefined}>Failed</span>
                    )}
                  </td>
                </tr>
              ))}
              {accessLog.length === 0 && (
                <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-8 text-center text-ink-soft">No MCP queries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label, checked, disabled, onChange,
}: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 ${disabled ? "bg-surface-2" : "bg-white"}`}>
      <span className="text-xs font-semibold text-navy">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-kplc disabled:opacity-50"
      />
    </label>
  );
}
