// `server-guard` rather than the `server-only` package, for the reason set out
// in that file: `server-only` throws unconditionally outside Next's bundler, so
// this module could not be exercised from a plain script — which meant the only
// way to see whether a document actually looked right was to deploy it. The
// guard checks the thing that matters (did this reach a browser) and leaves
// `npx tsx` able to render a proof sheet to disk.
import "./server-guard";
// The Node printer, not the browser bundle that `pdfmake`'s main entry exposes.
import PdfPrinter from "pdfmake/js/Printer";
import URLResolver from "pdfmake/js/URLResolver";
import virtualfs from "pdfmake/js/virtual-fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Content, TDocumentDefinitions, ContentTable, TableCell,
} from "pdfmake/interfaces";

/**
 * PDF generation.
 *
 * pdfmake, server-side, using the PDF standard-14 fonts. That choice matters:
 * pdfmake normally ships a ~1 MB embedded Roboto, and puppeteer would drag in
 * ~300 MB of Chromium that will not run on Vercel's serverless runtime at all.
 * Declaring Helvetica maps onto fonts every PDF reader already has, so a
 * boardroom-quality document costs no font bytes and no browser.
 *
 * pdfmake also gives us the two things that make a document look professional
 * rather than printed-from-a-webpage: real page breaks that never split a row,
 * and a footer callback that knows the total page count.
 */

export const KPLC_GREEN = "#006837";
export const KPLC_NAVY = "#0a1a4f";
export const KPLC_BLUE = "#1e40af";
export const KPLC_GOLD = "#f5b700";
const INK_SOFT = "#5b6480";
const LINE = "#e2e5eb";

/**
 * pdfmake 0.3's Printer takes four arguments, not just fonts. The URL resolver
 * is NOT optional in practice: createPdfKitDocument awaits `urlResolver
 * .resolved()` unconditionally, so omitting it throws even for a document that
 * contains no remote images at all. Ours never do — every photo is inlined as a
 * data URI before it reaches here — but the resolver still has to exist.
 */
const printer = new PdfPrinter(
  {
    Helvetica: {
      normal: "Helvetica",
      bold: "Helvetica-Bold",
      italics: "Helvetica-Oblique",
      bolditalics: "Helvetica-BoldOblique",
    },
  },
  virtualfs,
  new URLResolver(virtualfs),
);

/** Status → fill colour, matching the badges used everywhere else. */
export const STATUS_FILL: Record<string, string> = {
  IN_FIELD: "#d1fae5",
  FAULTY: "#fee2e2",
  IN_STORE: "#dbeafe",
  IN_TRANSIT: "#ede9fe",
  RETURNED: "#e5e7eb",
  SCRAPPED: "#e5e7eb",
};

let logoCache: string | null | undefined;

/** The KPLC mark as a data URI, read once per process. */
async function logoDataUri(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", "images", "kenya-power-logo.png"));
    logoCache = `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    logoCache = null; // a missing logo is cosmetic; the report must still build
  }
  return logoCache;
}

/**
 * Fetches remote photos and inlines them as data URIs.
 *
 * A PDF must be self-contained — a linked image would show as a broken box on
 * a machine without network access, which is exactly where these get opened.
 * Failures are skipped silently rather than failing the whole report.
 */
export async function embedPhotos(
  urls: string[],
  max = 12,
): Promise<{ url: string; data: string }[]> {
  const out: { url: string; data: string }[] = [];
  for (const url of urls.slice(0, max)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) continue; // keep the file emailable

      // Trust the bytes, not the Content-Type header. PDF embeds only JPEG and
      // PNG; a phone that uploaded WebP or HEIC still says "image/…", and
      // handing that to the PDF engine throws "Unknown image format" and takes
      // the whole document down with it.
      const magic = buf.subarray(0, 4).toString("hex");
      const isJpeg = magic.startsWith("ffd8ff");
      const isPng = magic === "89504e47";

      let mime = isJpeg ? "image/jpeg" : "image/png";
      if (!isJpeg && !isPng) {
        // Anything else — WebP, HEIC, AVIF, TIFF — gets converted. These are
        // site photographs attached to warranty claims; dropping them silently
        // would remove the evidence the report exists to carry.
        const sharp = (await import("sharp")).default;
        buf = await sharp(buf).png().toBuffer();
        mime = "image/png";
      }

      out.push({ url, data: `data:${mime};base64,${buf.toString("base64")}` });
    } catch {
      // Unreachable or undecodable photo — omit it rather than fail the
      // document. A report missing one picture still beats no report.
    }
  }
  return out;
}

export function sectionTitle(text: string): Content {
  return {
    text,
    style: "section",
    margin: [0, 16, 0, 8],
  };
}

/** A two-column label/value table — the workhorse for detail pages. */
export function detailTable(rows: [string, string | number | null][]): ContentTable {
  const body: TableCell[][] = rows
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v], i) => [
      { text: k, bold: true, color: KPLC_NAVY, fillColor: i % 2 ? "#f7f8fa" : undefined },
      { text: String(v), color: "#1c1f1f", fillColor: i % 2 ? "#f7f8fa" : undefined },
    ]);

  if (body.length === 0) body.push([{ text: "No data", italics: true, colSpan: 2, color: INK_SOFT }, {}]);

  return {
    table: { widths: [150, "*"], body },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      paddingTop: () => 5,
      paddingBottom: () => 5,
      paddingLeft: () => 8,
    },
  };
}

/** A data table with a KPLC-green header row and zebra striping. */
export function dataTable(
  headers: string[],
  rows: (string | number | null)[][],
  widths?: (number | string)[],
  fillFor?: (row: (string | number | null)[]) => string | undefined,
): ContentTable {
  const body: TableCell[][] = [
    headers.map((h) => ({
      text: h,
      bold: true,
      color: "#ffffff",
      fillColor: KPLC_GREEN,
      fontSize: 8,
    })),
  ];

  if (rows.length === 0) {
    body.push([{ text: "No data available", italics: true, colSpan: headers.length, color: INK_SOFT, fontSize: 8 }, ...Array(headers.length - 1).fill({})]);
  }

  rows.forEach((row, i) => {
    const custom = fillFor?.(row);
    body.push(
      row.map((cell) => ({
        text: cell == null || cell === "" ? "—" : String(cell),
        fontSize: 8,
        fillColor: custom ?? (i % 2 ? "#f7f8fa" : undefined),
      })),
    );
  });

  return {
    table: { headerRows: 1, widths: widths ?? headers.map(() => "*"), body, dontBreakRows: true },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      paddingTop: () => 4,
      paddingBottom: () => 4,
      paddingLeft: () => 6,
    },
  };
}

/** A coloured pill, used for status and result values. */
export function badge(text: string, fill: string, color = KPLC_NAVY): Content {
  return {
    table: { body: [[{ text, fillColor: fill, color, bold: true, fontSize: 9, margin: [6, 3, 6, 3] }]] },
    layout: "noBorders",
  };
}

/**
 * A tick box that is actually drawn, not typed.
 *
 * The obvious way to render a checklist is the ballot-box characters, U+2610
 * and U+2612. They cannot be used here. The standard-14 fonts this module
 * relies on carry WinAnsi encoding, which has 224 glyphs and neither of those
 * is among them — the box would come out as a wrong character or take the
 * document down. The same applies to the hourglass and every other emoji.
 *
 * So the box is a one-cell table with a real border and an X inside it. It
 * survives photocopying, which the character would not have anyway.
 */
export function tickBox(ticked: boolean): TableCell {
  return {
    // lineHeight 1 here on purpose: the document default is 1.25, which adds
    // leading inside a 10pt cell and pushed the X through the top border.
    table: { widths: [9], heights: [9], body: [[{ text: ticked ? "X" : " ", fontSize: 7, lineHeight: 1, bold: true, alignment: "center", color: KPLC_NAVY }]] },
    layout: {
      hLineWidth: () => 0.8,
      vLineWidth: () => 0.8,
      hLineColor: () => KPLC_NAVY,
      vLineColor: () => KPLC_NAVY,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 1.5,
      paddingBottom: () => 0,
    },
  };
}

/**
 * The checklist of actions, with exactly one ticked.
 *
 * Two columns rather than one long list. Eight stacked rows ate a third of the
 * sheet and pushed the signatures onto a second page — and a two-page approval
 * certificate where page two holds only a signature block is the shape of a
 * document nobody files correctly.
 */
export function tickList(items: { label: string; ticked: boolean }[]): ContentTable {
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);
  const cell = (i: { label: string; ticked: boolean } | undefined): TableCell[] =>
    i
      ? [
          tickBox(i.ticked),
          { text: i.label, fontSize: 8.5, bold: i.ticked, color: i.ticked ? KPLC_NAVY : INK_SOFT, margin: [3, 0, 0, 0] },
        ]
      : [{ text: "" }, { text: "" }];

  return {
    table: {
      widths: [12, "*", 12, "*"],
      body: left.map((l, idx) => [...cell(l), ...cell(right[idx])]),
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5,
      paddingLeft: () => 0,
      paddingRight: () => 4,
    },
  };
}

/** A compact section heading for single-sheet documents. */
export function sheetTitle(text: string): Content {
  return { text: text.toUpperCase(), fontSize: 8.5, bold: true, color: KPLC_GREEN, characterSpacing: 0.6, margin: [0, 11, 0, 4] };
}

/**
 * A narrow label/value table, sized to sit inside a half-width column.
 *
 * `detailTable` uses a fixed 150pt label column, which is right at full width
 * and overflows the moment two of them sit side by side.
 */
export function miniTable(rows: [string, string | number | null][]): ContentTable {
  const body: TableCell[][] = rows.map(([k, v], i) => [
    { text: k, bold: true, fontSize: 8, color: KPLC_NAVY, fillColor: i % 2 ? "#f7f8fa" : undefined },
    { text: v == null || v === "" ? "—" : String(v), fontSize: 8, color: "#1c1f1f", fillColor: i % 2 ? "#f7f8fa" : undefined },
  ]);
  if (body.length === 0) body.push([{ text: "No data", italics: true, colSpan: 2, color: INK_SOFT }, {}]);
  return {
    table: { widths: [66, "*"], body },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      paddingTop: () => 3.5,
      paddingBottom: () => 3.5,
      paddingLeft: () => 6,
    },
  };
}

/** A ruled line somebody signs on, with the role printed underneath. */
export function signatureLine(caption: string, width = 200): Content {
  return {
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.8, lineColor: KPLC_NAVY }], margin: [0, 26, 0, 0] },
      { text: caption, fontSize: 7.5, color: INK_SOFT, margin: [0, 4, 0, 0] },
    ],
  };
}

export type SheetOptions = {
  /** "APPROVAL CERTIFICATE" — the band across the top of the sheet. */
  documentType: string;
  /** "APR-2026-00042" — printed in the letterhead and in the footer. */
  reference: string;
  /** The coloured status strip: text plus its fill. */
  statusText: string;
  statusFill: string;
  statusColor?: string;
  /** Optional QR image (data URI) printed in the letterhead. */
  qrDataUri?: string | null;
  content: Content[];
};

/**
 * One-sheet official document — certificates, requests, permits.
 *
 * Deliberately NOT `buildPdf`. That one opens with a full-page cover and a
 * page break, which is right for a twenty-page regional report and absurd for
 * a single-page approval: the reader would turn a title page to reach four
 * paragraphs. A utility's approval sheet is one page with a letterhead at the
 * top, and anybody who has filed one recognises the shape instantly.
 *
 * Everything else is shared with `buildPdf` — same printer, same standard-14
 * fonts, same logo cache, same footer — so the two document families look like
 * they came from the same organisation, which is the entire point.
 */
export async function buildSheet({
  documentType,
  reference,
  statusText,
  statusFill,
  statusColor = KPLC_NAVY,
  qrDataUri,
  content,
}: SheetOptions): Promise<Uint8Array<ArrayBuffer>> {
  const logo = await logoDataUri();
  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const letterhead: Content = {
    columns: [
      ...(logo ? [{ image: logo, width: 54, width_: 0 } as never] : []),
      {
        width: "*",
        stack: [
          { text: "KENYA POWER AND LIGHTING COMPANY PLC", fontSize: 11, bold: true, color: KPLC_NAVY },
          { text: "Transformer DNA  |  Distribution Asset Lifecycle Management", fontSize: 8, color: INK_SOFT, margin: [0, 2, 0, 0] },
          { text: `Document ${reference}`, fontSize: 8, bold: true, color: KPLC_GREEN, margin: [0, 4, 0, 0] },
        ],
        margin: [10, 4, 0, 0],
      },
      ...(qrDataUri
        ? [{ image: qrDataUri, width: 52, alignment: "right" as const, width_: 0 } as never]
        : []),
    ],
    columnGap: 6,
  };

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [46, 40, 46, 54],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: "#1c1f1f", lineHeight: 1.25 },
    styles: {
      section: { fontSize: 10, bold: true, color: KPLC_GREEN },
      h2: { fontSize: 11, bold: true, color: KPLC_NAVY },
      muted: { fontSize: 8, color: INK_SOFT },
    },
    info: { title: `${documentType} ${reference}`, author: "Transformer DNA — Kenya Power" },

    footer: (currentPage, pageCount) => ({
      margin: [46, 12, 46, 0],
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 503, y2: 0, lineWidth: 0.5, lineColor: LINE }] },
        {
          margin: [0, 6, 0, 0],
          columns: [
            { text: `${reference}  |  Kenya Power  |  Transformer DNA`, fontSize: 7, color: INK_SOFT, width: "*" },
            { text: `Generated ${generated}`, fontSize: 7, color: INK_SOFT, width: "auto", margin: [0, 0, 12, 0] },
            { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: INK_SOFT, width: "auto" },
          ],
        },
      ],
    }),

    content: [
      letterhead,
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 503, y2: 0, lineWidth: 2, lineColor: KPLC_GOLD }], margin: [0, 10, 0, 0] },

      // The document type band. Big, boxed and unambiguous, because the first
      // thing somebody holding this needs to know is whether it is a request
      // or an authority to act — and those two get filed very differently.
      {
        margin: [0, 14, 0, 0],
        table: {
          widths: ["*", "auto"],
          body: [[
            { text: documentType, fontSize: 15, bold: true, color: "#ffffff", fillColor: KPLC_NAVY, margin: [10, 8, 6, 8] },
            { text: statusText, fontSize: 9.5, bold: true, color: statusColor, fillColor: statusFill, margin: [10, 8, 10, 8], alignment: "right" },
          ]],
        },
        layout: "noBorders",
      },

      ...content,
    ],
  };

  const pdf = await printer.createPdfKitDocument(doc);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => {
      const merged = Buffer.concat(chunks);
      resolve(new Uint8Array(merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength) as ArrayBuffer));
    });
    pdf.on("error", reject);
    pdf.end();
  });
}

export type CoverOptions = {
  title: string;
  headline: string;
  subhead?: string;
  meta: [string, string][];
};

async function coverPage(cover: CoverOptions): Promise<Content[]> {
  const logo = await logoDataUri();
  return [
    ...(logo ? [{ image: logo, width: 90, alignment: "center" as const, margin: [0, 60, 0, 20] as [number, number, number, number] }] : [{ text: "", margin: [0, 90, 0, 0] as [number, number, number, number] }]),
    { text: "Transformer DNA", alignment: "center", fontSize: 16, bold: true, color: KPLC_NAVY },
    { text: "Kenya Power Distribution Assets", alignment: "center", fontSize: 10, color: INK_SOFT, margin: [0, 2, 0, 40] },
    { canvas: [{ type: "line", x1: 140, y1: 0, x2: 375, y2: 0, lineWidth: 2, lineColor: KPLC_GOLD }] },
    { text: cover.headline, alignment: "center", fontSize: 30, bold: true, color: KPLC_NAVY, margin: [0, 26, 0, 0] },
    ...(cover.subhead ? [{ text: cover.subhead, alignment: "center" as const, fontSize: 12, color: INK_SOFT, margin: [0, 6, 0, 0] as [number, number, number, number] }] : []),
    { text: cover.title, alignment: "center", fontSize: 14, bold: true, color: KPLC_GREEN, margin: [0, 26, 0, 30] },
    { canvas: [{ type: "line", x1: 140, y1: 0, x2: 375, y2: 0, lineWidth: 0.5, lineColor: LINE }] },
    {
      margin: [110, 24, 110, 0],
      table: {
        widths: [90, "*"],
        body: cover.meta.map(([k, v]) => [
          { text: k, fontSize: 9, color: INK_SOFT },
          { text: v, fontSize: 9, bold: true, color: KPLC_NAVY },
        ]),
      },
      layout: "noBorders",
    },
  ];
}

/**
 * Renders a document and returns the bytes.
 *
 * The footer is a callback so it can print "Page X of Y" — pdfmake only knows
 * the total once layout is done, which is why this cannot be static content.
 */
export async function buildPdf({
  cover,
  content,
  landscape = false,
}: {
  cover: CoverOptions;
  content: Content[];
  landscape?: boolean;
}): Promise<Uint8Array<ArrayBuffer>> {
  const logo = await logoDataUri();
  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [40, 62, 40, 48],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: "#1c1f1f", lineHeight: 1.25 },
    styles: {
      section: { fontSize: 13, bold: true, color: KPLC_GREEN },
      h2: { fontSize: 11, bold: true, color: KPLC_NAVY },
      muted: { fontSize: 8, color: INK_SOFT },
    },
    info: { title: `${cover.headline} — ${cover.title}`, author: "Transformer DNA" },

    // Every page after the cover gets the running head.
    header: (currentPage) =>
      currentPage === 1
        ? undefined
        : {
            margin: [40, 18, 40, 0],
            columns: [
              { text: cover.title, fontSize: 8, bold: true, color: KPLC_NAVY, width: "*" },
              ...(logo ? [{ image: logo, width: 22, alignment: "right" as const, width_: 0 } as never] : []),
            ],
            columnGap: 8,
          },

    footer: (currentPage, pageCount) => ({
      margin: [40, 10, 40, 0],
      columns: [
        {
          text: "Transformer DNA  |  Kenya Power",
          fontSize: 7, color: INK_SOFT, width: "*",
        },
        { text: `Generated ${generated}`, fontSize: 7, color: INK_SOFT, width: "auto", margin: [0, 0, 12, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: INK_SOFT, width: "auto" },
      ],
    }),

    content: [
      ...(await coverPage(cover)),
      { text: "", pageBreak: "after" },
      ...content,
    ],
  };

  // Async in pdfmake 0.3 — it resolves image sources before laying out.
  const pdf = await printer.createPdfKitDocument(doc);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => {
      const merged = Buffer.concat(chunks);
      resolve(new Uint8Array(merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength) as ArrayBuffer));
    });
    pdf.on("error", reject);
    pdf.end();
  });
}
