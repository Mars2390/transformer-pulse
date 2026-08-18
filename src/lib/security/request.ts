import "server-only";

/**
 * Who is calling, as far as the edge will tell us.
 *
 * The header order matters and is not arbitrary. On Vercel the platform sets
 * x-forwarded-for and appends the real client at the LEFT of the list, so the
 * first entry is the client and everything after it is proxy chain. Reading
 * the last entry — which several tutorials suggest — gives you the address of
 * your own load balancer and makes every rate limit global.
 *
 * A client can send x-forwarded-for itself. Behind Vercel that header is
 * overwritten by the platform, so it is trustworthy there; self-hosted behind
 * a proxy that does not overwrite it, it is attacker-controlled and per-IP
 * limits become bypassable by spoofing. That is a deployment property, not a
 * code property, and it is why UNKNOWN_IP is treated as its own bucket rather
 * than skipped.
 */
export const UNKNOWN_IP = "unknown";

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return normaliseIp(first);
  }
  const real = request.headers.get("x-real-ip");
  if (real) return normaliseIp(real.trim());
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return normaliseIp(vercel.split(",")[0]!.trim());
  return UNKNOWN_IP;
}

/** IPv4-mapped IPv6 and bracketed forms collapse to one key, or they count twice. */
function normaliseIp(ip: string): string {
  let out = ip;
  if (out.startsWith("[") && out.includes("]")) out = out.slice(1, out.indexOf("]"));
  if (out.startsWith("::ffff:")) out = out.slice(7);
  return out.slice(0, 45);
}

export type DeviceInfo = {
  deviceType: string;
  browser: string;
  os: string;
};

/**
 * User-agent parsing, by hand.
 *
 * No ua-parser dependency: this feeds an incident timeline, not a billing
 * decision, and "Chrome on Android" is all an analyst needs to tell one
 * attempt from another. A wrong guess costs a slightly vaguer log line; a new
 * dependency in the auth path costs a supply-chain surface.
 */
/** Shared by parseUserAgent and looksAutomated so the two never disagree. */
const AUTOMATED =
  /bot|crawl|spider|curl|wget|python-requests|postman|httpie|go-http|scrapy|nikto|sqlmap|nmap|masscan|zgrab|hydra|burp|nuclei/i;

export function parseUserAgent(ua: string | null): DeviceInfo {
  if (!ua) return { deviceType: "unknown", browser: "unknown", os: "unknown" };

  const s = ua.toLowerCase();

  const deviceType = /ipad|tablet|playbook|silk/.test(s)
    ? "tablet"
    : /mobi|iphone|ipod|android.*mobile|windows phone/.test(s)
      ? "mobile"
      : AUTOMATED.test(s)
        ? "bot"
        : "desktop";

  const browser =
    /edg\//.test(s) ? "Edge"
    : /opr\/|opera/.test(s) ? "Opera"
    : /samsungbrowser/.test(s) ? "Samsung Internet"
    : /chrome|crios/.test(s) ? "Chrome"
    : /firefox|fxios/.test(s) ? "Firefox"
    : /safari/.test(s) ? "Safari"
    : /curl/.test(s) ? "curl"
    : /python-requests/.test(s) ? "python-requests"
    : "unknown";

  const os =
    /windows nt 10|windows nt 11/.test(s) ? "Windows"
    : /windows/.test(s) ? "Windows"
    : /android/.test(s) ? "Android"
    : /iphone|ipad|ipod|ios/.test(s) ? "iOS"
    : /mac os x|macintosh/.test(s) ? "macOS"
    : /linux/.test(s) ? "Linux"
    : "unknown";

  return { deviceType, browser, os };
}

/** True for the obvious automated clients. Not a control — a signal. */
export function looksAutomated(ua: string | null): boolean {
  if (!ua) return true;
  return AUTOMATED.test(ua);
}

/**
 * clientIp() reading a Headers bag. Same left-most x-forwarded-for rule, same
 * reasoning: the perimeter in requireApiUser() holds headers, not a Request.
 */
export function clientIpFromHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") ?? UNKNOWN_IP;
}
