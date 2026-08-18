import "server-only";

/**
 * File upload validation.
 *
 * The important rule: the CONTENT decides the type, not the name and not the
 * Content-Type header. Both of those are supplied by whoever is uploading, and
 * a file called photo.jpg announcing itself as image/jpeg can hold anything at
 * all. Reading the first few bytes is what turns a claim into a check.
 *
 * The stored name is generated server side. Using the client's filename is how
 * a path traversal ("../../etc/cron.d/x") or a double extension ("x.jpg.html",
 * served back as HTML and executed in the user's session) gets in.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type Signature = { mime: string; ext: string; magic: number[]; offset?: number };

const SIGNATURES: Signature[] = [
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
  { mime: "image/gif", ext: "gif", magic: [0x47, 0x49, 0x46, 0x38] },
  { mime: "application/pdf", ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  // XLSX and DOCX are ZIP containers; the distinction comes from the extension
  // the caller asked for, which is only trusted once the container is proven.
  { mime: "application/zip", ext: "xlsx", magic: [0x50, 0x4b, 0x03, 0x04] },
];

export type UploadVerdict =
  | { ok: true; extension: string; detectedMime: string; storedName: string }
  | { ok: false; reason: string };

/**
 * Executable and script content that must never be accepted, whatever the
 * extension says. This is a sanity check on obvious cases, not malware
 * scanning — calling it antivirus would be a lie, and a lie in a security
 * control is worse than a gap, because somebody stops looking.
 */
const FORBIDDEN_MAGIC: { label: string; magic: number[] }[] = [
  { label: "Windows executable", magic: [0x4d, 0x5a] },
  { label: "ELF binary", magic: [0x7f, 0x45, 0x4c, 0x46] },
  { label: "Mach-O binary", magic: [0xcf, 0xfa, 0xed, 0xfe] },
  { label: "Java class", magic: [0xca, 0xfe, 0xba, 0xbe] },
  { label: "shell script", magic: [0x23, 0x21] },
];

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

export function validateUpload(opts: {
  bytes: Uint8Array;
  originalName: string;
  allow?: string[];
}): UploadVerdict {
  const { bytes, originalName } = opts;
  const allow = opts.allow ?? ["jpg", "png", "webp", "gif", "pdf", "xlsx", "csv"];

  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `Files must be ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller.` };
  }

  for (const f of FORBIDDEN_MAGIC) {
    if (startsWith(bytes, f.magic)) {
      return { ok: false, reason: `That file is a ${f.label}, which is never accepted.` };
    }
  }

  const claimedExt = (originalName.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = SIGNATURES.find((sig) => startsWith(bytes, sig.magic, sig.offset));

  // CSV has no magic number; it is validated as text instead.
  if (!match && claimedExt === "csv") {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 2048));
    if (/<\s*script|<\s*iframe|^\s*<!doctype html/i.test(head)) {
      return { ok: false, reason: "That file claims to be CSV but contains HTML." };
    }
    if (!allow.includes("csv")) return { ok: false, reason: "CSV is not accepted here." };
    return { ok: true, extension: "csv", detectedMime: "text/csv", storedName: storedName("csv") };
  }

  if (!match) {
    return { ok: false, reason: "That file type is not accepted. Use a photo, a PDF, a spreadsheet or a CSV." };
  }

  const extension = match.ext === "xlsx" && claimedExt === "docx" ? "docx" : match.ext;
  if (!allow.includes(extension)) {
    return { ok: false, reason: `${extension.toUpperCase()} files are not accepted here.` };
  }

  return { ok: true, extension, detectedMime: match.mime, storedName: storedName(extension) };
}

/**
 * A generated name. The caller's filename is recorded as metadata elsewhere if
 * it is wanted, but it never reaches the filesystem or the object store key.
 */
function storedName(extension: string): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${Date.now()}-${random}.${extension}`;
}
