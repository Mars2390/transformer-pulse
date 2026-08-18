import "server-only";

/**
 * Attack-pattern detection.
 *
 * Read this before relying on it: these functions are TELEMETRY, not the
 * control that stops the attack.
 *
 * SQL injection is prevented by Prisma, which parameterises every query — the
 * one raw statement in the codebase is a tagged template, which is also
 * parameterised. Cross-site scripting is prevented by React, which escapes
 * every interpolated value, and the codebase contains no dangerouslySetInnerHTML
 * and no innerHTML assignment. Those two facts are what make the system safe.
 *
 * What these patterns add is knowing you are being probed. An engineer who
 * sees forty SQL_INJECTION_ATTEMPT rows from one address at 03:00 learns
 * something real, and learns it before the attacker finds a gap somewhere else.
 * Treating the detector as the defence would be the mistake: a blocklist of
 * strings is trivially evaded, and building on it invites relaxing the controls
 * that actually work.
 *
 * The rules are deliberately tuned to a low false-positive rate. A KPLC
 * location description genuinely reads "Wanyee rd, opp. Shell — 2 poles S of
 * the mosque"; anything that flags an apostrophe alone would fire constantly,
 * be ignored within a week, and take the real signals down with it.
 */

const SQL_PATTERNS: { rx: RegExp; label: string }[] = [
  { rx: /\bunion\b[\s\S]{0,20}\bselect\b/i, label: "UNION SELECT" },
  { rx: /\b(drop|truncate)\b\s+\b(table|database|schema)\b/i, label: "DROP/TRUNCATE" },
  { rx: /\bdelete\b\s+\bfrom\b/i, label: "DELETE FROM" },
  { rx: /\binsert\b\s+\binto\b/i, label: "INSERT INTO" },
  { rx: /('|%27|")\s*(or|and)\s*('|%27|")?\s*\d+\s*=\s*\d+/i, label: "tautology (' OR 1=1)" },
  { rx: /\bor\b\s+\d+\s*=\s*\d+\s*(--|#|\/\*)/i, label: "tautology with comment" },
  { rx: /;\s*(drop|delete|update|insert|alter|grant)\b/i, label: "stacked statement" },
  { rx: /\b(sleep|pg_sleep|waitfor\s+delay|benchmark)\s*\(/i, label: "time-based probe" },
  { rx: /\b(information_schema|pg_catalog|pg_tables|sysobjects)\b/i, label: "catalog probe" },
  { rx: /\b(xp_cmdshell|load_file|into\s+outfile)\b/i, label: "file/command primitive" },
  { rx: /\/\*!\d+/, label: "MySQL versioned comment" },
];

const XSS_PATTERNS: { rx: RegExp; label: string }[] = [
  { rx: /<\s*script\b/i, label: "<script>" },
  { rx: /<\s*\/\s*script\s*>/i, label: "</script>" },
  { rx: /\bjavascript\s*:/i, label: "javascript: URL" },
  { rx: /\bdata:text\/html/i, label: "data:text/html" },
  { rx: /\bon(error|load|click|mouseover|focus|animationstart|toggle)\s*=/i, label: "inline event handler" },
  { rx: /<\s*(iframe|object|embed|svg|img)[^>]*\bon\w+\s*=/i, label: "tag with handler" },
  { rx: /document\s*\.\s*(cookie|domain|write)/i, label: "document.cookie/write" },
  { rx: /\beval\s*\(|\bnew\s+Function\s*\(/i, label: "eval()" },
  { rx: /<\s*iframe\b/i, label: "<iframe>" },
  { rx: /&#x?[0-9a-f]{2,};?\s*script/i, label: "entity-encoded script" },
];

const PATH_TRAVERSAL = /(\.\.[/\\]){2,}|%2e%2e[/\\]|\/etc\/passwd|\bboot\.ini\b/i;

export type Detection = { kind: "SQL" | "XSS" | "TRAVERSAL"; label: string; sample: string };

/**
 * Walks a decoded request payload looking for the patterns above.
 *
 * Depth- and size-bounded on purpose: this runs on every write request, and an
 * attacker who can make the detector itself expensive has turned a security
 * control into a denial-of-service primitive.
 */
export function detectAttack(value: unknown, depth = 0): Detection | null {
  if (depth > 6 || value == null) return null;

  if (typeof value === "string") {
    if (value.length > 20_000) return null;
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }
    for (const target of new Set([value, decoded])) {
      for (const p of SQL_PATTERNS) {
        if (p.rx.test(target)) return { kind: "SQL", label: p.label, sample: target.slice(0, 200) };
      }
      for (const p of XSS_PATTERNS) {
        if (p.rx.test(target)) return { kind: "XSS", label: p.label, sample: target.slice(0, 200) };
      }
      if (PATH_TRAVERSAL.test(target)) {
        return { kind: "TRAVERSAL", label: "path traversal", sample: target.slice(0, 200) };
      }
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) {
      const hit = detectAttack(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
      const keyHit = detectAttack(k, depth + 1);
      if (keyHit) return keyHit;
      const hit = detectAttack(v, depth + 1);
      if (hit) return hit;
    }
  }

  return null;
}

/**
 * Escapes the five HTML metacharacters.
 *
 * Provided for the one place it is correct — text interpolated into a PDF or a
 * generated HTML export, outside React's escaping. It is deliberately NOT
 * applied to inputs on the way into the database. Sanitising on write corrupts
 * legitimate KPLC data (a site note reading "phase A < phase B" becomes
 * "phase A &lt; phase B" forever) and it hides an attack instead of recording
 * it. Escape on output, validate on input, log what looks wrong.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
