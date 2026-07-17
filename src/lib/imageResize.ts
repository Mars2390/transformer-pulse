"use client";

/**
 * Resize a photo in the browser before upload.
 *
 * A modern phone camera produces a 3–5 MB image. On 3G in the field that upload
 * can take a minute and fail halfway. Downscaling to 1600px at JPEG q0.8 brings
 * it to ~200–300 KB with no visible loss for a nameplate or a site photo — and
 * it finishes.
 *
 * Runs entirely on the client; the original bytes never leave the device until
 * they are small.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

export async function resizeImage(file: File): Promise<File> {
  // Not an image, or already tiny — leave it alone.
  if (!file.type.startsWith("image/") || file.size < 300 * 1024) {
    return file;
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // decoding failed; let the server deal with it

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return file;

  // If resizing somehow made it larger (already-compressed small JPEGs can do
  // this), keep the original.
  if (blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}
