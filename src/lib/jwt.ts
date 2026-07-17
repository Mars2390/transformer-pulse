/**
 * A minimal HS256 JWT, built on WebCrypto.
 *
 * Why not a library:
 *
 * This code runs in middleware — the Edge runtime, on every single request.
 * Edge has no Node built-ins, and a library that reaches for one fails at
 * invocation with an error that says nothing useful (MIDDLEWARE_INVOCATION_
 * FAILED). WebCrypto's `crypto.subtle` is native in the Edge runtime, native in
 * Node 22, and native in the browser. Nothing to bundle, nothing to polyfill,
 * nothing to break when a dependency changes its internals.
 *
 * It is also ~80 lines you can read end to end and defend to a KPLC security
 * reviewer, which a 100KB dependency is not.
 *
 * Scope: HS256 only. We sign and verify our own session cookie — we never
 * consume a third party's token, so there is no algorithm negotiation, and
 * therefore none of the algorithm-confusion attacks that come with it.
 */

const encoder = new TextEncoder();

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes =
    typeof input === "string" ? encoder.encode(input) : input;

  // Build the binary string in chunks. String.fromCharCode(...bytes) blows the
  // call stack on large inputs; ours are small, but this cannot be the thing
  // that fails at 2am.
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToString(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

// Uint8Array<ArrayBuffer>, not the default ArrayBufferLike: only the former
// satisfies WebCrypto's BufferSource, since ArrayBufferLike also admits
// SharedArrayBuffer.
function base64UrlDecodeToBytes(input: string): Uint8Array<ArrayBuffer> {
  const binary = base64UrlDecodeToString(input);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export type JwtPayload = Record<string, unknown> & {
  sub?: string;
  iat?: number;
  exp?: number;
};

/** Signs a payload. `expiresInSeconds` sets `exp`. */
export async function signJwt(
  payload: JwtPayload,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64UrlEncode(JSON.stringify(body));
  const data = `${header}.${claims}`;

  const signature = await crypto.subtle.sign(
    "HMAC",
    await importKey(secret),
    encoder.encode(data),
  );

  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies a token and returns its payload, or null.
 *
 * Null for every failure — bad signature, expired, malformed, wrong shape.
 * A caller must never be able to tell those apart, because the answer to all of
 * them is identical: you are not signed in.
 */
export async function verifyJwt(
  token: string | undefined,
  secret: string | undefined,
): Promise<JwtPayload | null> {
  if (!token || !secret) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, claims, signature] = parts;

    // crypto.subtle.verify does the constant-time comparison for us. Comparing
    // signatures with === would leak, byte by byte, how much of a forgery was
    // correct.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await importKey(secret),
      base64UrlDecodeToBytes(signature),
      encoder.encode(`${header}.${claims}`),
    );
    if (!valid) return null;

    // Only trust the header AFTER the signature checks out.
    const { alg } = JSON.parse(base64UrlDecodeToString(header));
    if (alg !== "HS256") return null;

    const payload = JSON.parse(base64UrlDecodeToString(claims)) as JwtPayload;

    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
