import "server-only";

/**
 * Cross-site request forgery defence by Origin check.
 *
 * Stronger than the SameSite cookie attribute and, unlike SameSite=Strict, it
 * costs nothing in navigation behaviour. Browsers set Origin on every
 * state-changing request and a page cannot forge it, so comparing it against
 * the host that served the request is a complete answer for the browser case.
 *
 * A missing Origin is allowed. Non-browser clients — the MCP server, curl in a
 * runbook, a monitoring probe — do not send one, and those callers authenticate
 * with a bearer token rather than a cookie, so they were never exposed to CSRF
 * in the first place. Refusing them would break real integrations to defend
 * against an attack that does not apply to them.
 */
export function assertSameOrigin(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The same Origin rule as assertSameOrigin(), for callers holding a Headers bag
 * rather than a Request. requireApiUser() reads next/headers, so it has headers
 * and no Request; same rule, same reasoning, different input.
 *
 * It returns a boolean like its sibling rather than throwing, which keeps this
 * file free of imports and so unable to form a cycle with auth.ts. The caller
 * decides what a false is worth.
 */
export function assertSameOriginFromHeaders(h: Headers): boolean {
  const origin = h.get("origin");
  if (!origin) return true; // Same-origin form posts and server-to-server calls send none.
  const host = h.get("x-forwarded-host") ?? h.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // An unparseable Origin is not this site.
  }
}
