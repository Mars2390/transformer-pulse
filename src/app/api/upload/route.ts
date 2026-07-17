import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireApiUser, AuthError } from "@/lib/auth";

/**
 * POST /api/upload — store a field photo, return its URL.
 *
 * The heavy lifting (resizing a 4 MB phone photo down to ~250 KB) happens on
 * the CLIENT before the bytes ever leave the phone — see imageResize.ts. That
 * is not an optimisation; it is whether the upload finishes at all on 3G in
 * Juja. This route is the last line of defence: it re-checks the size, because
 * a request can always be crafted to skip the client.
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — a generous ceiling after resize
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  try {
    // Any signed-in user may upload — a field engineer must, and roles are
    // enforced on the EVENT that references the photo, not on the bytes.
    await requireApiUser();

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        {
          error:
            "Photo storage is not set up yet. Create a Blob store in Vercel (Storage → Create → Blob) and redeploy.",
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
        { error: "Only JPEG, PNG or WebP images are accepted." },
        { status: 415 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "That image is over 5 MB. It should have been resized first." },
        { status: 413 },
      );
    }

    const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    // A random suffix so two photos taken in the same second never collide.
    const key = `transformers/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;

    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
    });

    return NextResponse.json({ url: blob.url });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Upload failed:", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
