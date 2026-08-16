"use client";

/**
 * Preparing a nameplate photo for OCR.
 *
 * This is the opposite job from resizeImage(), and conflating the two is why
 * the scanner read almost nothing. resizeImage() shrinks a photo to 1600px so
 * it will UPLOAD over LTE — exactly the wrong thing to hand Tesseract, which
 * reads small engraved text better the more pixels it has.
 *
 * So the upload copy and the OCR copy are prepared separately. This one:
 *
 *   1. upscales the long edge to 2200px when the photo is smaller,
 *   2. converts to greyscale, because colour carries no information on a metal
 *      plate but does carry the rust and the blue cast of a workshop lamp,
 *   3. stretches contrast against the image's own 5th/95th percentile, which
 *      is what pulls engraved characters away from a scratched background.
 *
 * It deliberately does NOT binarise. Hard thresholding looks dramatic and
 * destroys thin strokes on a worn plate — the digits go first, and the digits
 * are the whole point.
 */

const TARGET_LONG_EDGE = 2200;

export async function prepareForOcr(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge < TARGET_LONG_EDGE ? TARGET_LONG_EDGE / longEdge : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return file;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const img = ctx.getImageData(0, 0, width, height);
  const px = img.data;

  // Greyscale using luminance weights, building a histogram as we go.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = g;
    histogram[g]++;
  }

  // 5th and 95th percentile rather than min/max: a single blown-out highlight
  // or one black screw hole would otherwise flatten the whole stretch.
  const total = width * height;
  const lowCut = total * 0.05;
  const highCut = total * 0.95;
  let acc = 0;
  let low = 0;
  let high = 255;
  for (let v = 0; v < 256; v++) {
    acc += histogram[v];
    if (acc >= lowCut) { low = v; break; }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += histogram[v];
    if (acc >= highCut) { high = v; break; }
  }

  const span = Math.max(1, high - low);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(0, Math.min(255, Math.round(((v - low) / span) * 255)));
  }
  for (let i = 0; i < px.length; i += 4) {
    const g = lut[px[i]];
    px[i] = px[i + 1] = px[i + 2] = g;
  }

  ctx.putImageData(img, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  return blob ?? file;
}
