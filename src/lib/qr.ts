import QRCode from "qrcode";

/**
 * What a transformer's QR code carries.
 *
 * A URL, not JSON. Three reasons, and the third is the one that matters:
 *
 *   1. Any phone's built-in camera opens a URL. A JSON blob shows the operator
 *      a wall of braces and no way forward.
 *   2. The G-Number is IN the URL path, so a scanner that never reaches the
 *      network still reads the identifier off the code — which is the offline
 *      behaviour asked for.
 *   3. The URL lands on the story page, which already requires a login. The QR
 *      therefore leaks nothing to a passer-by: scanning a sticker on a pole
 *      gets a stranger a sign-in screen, not an asset record.
 *
 * That third point is worth stating plainly because it is the actual security
 * control. A shared PIN is a speed bump on top of it, not a substitute for it.
 */
export function transformerQrUrl(baseUrl: string, gNumber: string | null, id: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  return gNumber ? `${root}/t/${encodeURIComponent(gNumber)}` : `${root}/transformers/${id}`;
}

export async function qrPng(text: string, size = 512): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0a1a4fff", light: "#ffffffff" },
  });
}

export async function qrDataUrl(text: string, size = 256): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0a1a4fff", light: "#ffffffff" },
  });
}

export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://transformer-pulse.vercel.app")
  );
}
