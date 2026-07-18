/**
 * pdfmake's Node-side internals.
 *
 * The package's main entry is the browser build; the server classes live under
 * `pdfmake/js/*` and @types/pdfmake does not declare those subpaths. This
 * declares the small surface we actually use, so the imports stay typed rather
 * than being cast through `any`.
 *
 * Note the shapes here match pdfmake 0.3, which differs from 0.2 in two ways
 * that matter: the Printer constructor takes four arguments (not just fonts),
 * and createPdfKitDocument is async.
 */
declare module "pdfmake/js/Printer" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  export default class PdfPrinter {
    constructor(
      fontDescriptors: Record<string, Record<string, string>>,
      virtualfs?: unknown,
      urlResolver?: unknown,
      localAccessPolicy?: unknown,
    );
    createPdfKitDocument(
      doc: TDocumentDefinitions,
    ): Promise<NodeJS.ReadableStream & { end(): void }>;
  }
}

declare module "pdfmake/js/URLResolver" {
  export default class URLResolver {
    constructor(virtualfs?: unknown);
    resolve(url: string, headers?: unknown): void;
    resolved(): Promise<void>;
  }
}

declare module "pdfmake/js/virtual-fs" {
  const virtualfs: unknown;
  export default virtualfs;
}
