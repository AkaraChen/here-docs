import type {
  AnydocDocument,
  AnydocPort,
  ConvertDeps,
  ImageNormalizerPort,
  OcrLine,
  OcrPage,
  OcrPort,
  PdfClassification,
  PdfInspectorPort,
  PdfProcessResult,
} from "../src/types.js";

export const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

export const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

export const pdfBytes = Uint8Array.from(Buffer.from("%PDF-1.4\n%eof\n"));

export const gifBytes = Uint8Array.from(Buffer.from("GIF89a"));

export function fakeDeps(overrides: Partial<ConvertDeps> = {}): ConvertDeps & {
  ocrCalls: { encoded: number; document: Array<{ start?: number; end?: number }> };
} {
  const ocrCalls = { encoded: 0, document: [] as Array<{ start?: number; end?: number }> };
  const anydoc: AnydocPort = overrides.anydoc ?? {
    formatFromBytes: () => null,
    formatFromExtension: (ext) => (ext === "csv" ? "csv" : null),
    toDocument: async () => emptyDocument(),
  };
  const ocr: OcrPort = overrides.ocr ?? {
    async recognizeEncoded() {
      ocrCalls.encoded += 1;
      return { lines: [{ text: "OCR" }] };
    },
    async *recognizeDocument(_bytes, options) {
      ocrCalls.document.push(options?.pageRange ?? {});
      yield { index: 0, lines: [{ text: "PAGE" }] };
    },
    async close() {},
  };
  const pdf: PdfInspectorPort = overrides.pdf ?? {
    async classify(): Promise<PdfClassification> {
      return { pdfType: "TextBased", pageCount: 1, pagesNeedingOcr: [] };
    },
    async process(): Promise<PdfProcessResult> {
      return {
        pdfType: "TextBased",
        pageCount: 1,
        pagesNeedingOcr: [],
        markdown: "# From PDF\n",
      };
    },
    async extractPagesMarkdown() {
      return [{ markdown: "# From PDF", page: 0 }];
    },
  };
  const images: ImageNormalizerPort = overrides.images ?? {
    async toPng(bytes) {
      return bytes;
    },
  };
  return { anydoc, ocr, pdf, images, ocrCalls };
}

export function emptyDocument(): AnydocDocument {
  return { blocks: [], notes: [], assets: [] };
}

export function trackingOcr(pages: OcrPage[], encoded: OcrLine[] = [{ text: "OCR" }]): OcrPort & {
  encodedCalls: number;
  documentRanges: Array<{ start?: number; end?: number }>;
} {
  const documentRanges: Array<{ start?: number; end?: number }> = [];
  let encodedCalls = 0;
  return {
    get encodedCalls() {
      return encodedCalls;
    },
    documentRanges,
    async recognizeEncoded() {
      encodedCalls += 1;
      return { lines: encoded };
    },
    async *recognizeDocument(_bytes, options) {
      documentRanges.push(options?.pageRange ?? {});
      const start = options?.pageRange?.start ?? 1;
      const end = options?.pageRange?.end ?? pages.length;
      for (const page of pages) {
        const oneBased = page.index + 1;
        if (oneBased >= start && oneBased <= end) {
          yield page;
        }
      }
    },
    async close() {},
  };
}
