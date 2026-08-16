import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { qrPng, siteUrl, transformerQrUrl } from "@/lib/qr";

/** GET /api/transformers/[id]/qr — the code as a PNG, ready to print and mount. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser();
    const { id } = await ctx.params;

    const t = await prisma.transformer.findUnique({
      where: { id },
      select: { id: true, gNumber: true, serialNumber: true },
    });
    if (!t) return new Response("Not found", { status: 404 });

    const png = await qrPng(transformerQrUrl(siteUrl(), t.gNumber, t.id), 640);

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${(t.gNumber ?? t.serialNumber).replace(/[^A-Za-z0-9-]/g, "")}-qr.png"`,
        // A transformer's QR never changes, so let phones and printers cache it.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
