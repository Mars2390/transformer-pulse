import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireApiUser, AuthError } from "@/lib/auth";
import { guard } from "@/lib/security/guard";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

/**
 * POST /api/documents/upload — store a document (FAT report, etc.), return its URL.
 *
 * Separate from /api/upload: that route is for field photos specifically
 * (images only, 5 MB ceiling after client-side resize). A FAT report is
 * often a scanned PDF that was never going to be resized, so this one allows
 * PDF alongside images and a higher ceiling.
 */

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ["application/pdf", "image/jpeg", "image/png"];

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const perimeter = await guard(request, { rule: RATE_LIMITS.UPLOADS });
    if (!perimeter.ok) return perimeter.response;

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        {
          error:
            "Document storage is not set up yet. Create a Blob store in Vercel (Storage → Create → Blob) and redeploy.",
        },
        { status: 503 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was sent." }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PDF, JPEG or PNG files are accepted." },
        { status: 415 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is over 10 MB." }, { status: 413 });
    }

    const extension = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const key = `documents/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;

    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
    });

    return NextResponse.json({ url: blob.url, name: file.name });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Document upload failed:", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
