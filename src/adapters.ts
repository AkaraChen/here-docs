import { assertNativePackages } from "./natives.js";
import type {
  AnydocDocument,
  AnydocPort,
  ConvertEngine,
  ImageNormalizerPort,
  OcrPort,
  PdfClassification,
  PdfInspectorPort,
  PdfProcessResult,
} from "./types.js";

export async function createEngine(): Promise<ConvertEngine> {
  assertNativePackages();
  const [anydoc, ocr, pdf, images] = await Promise.all([
    createAnydocPort(),
    createOcrPort(),
    createPdfPort(),
    createImagePort(),
  ]);
  return {
    anydoc,
    ocr,
    pdf,
    images,
    close: () => ocr.close(),
  };
}

async function createAnydocPort(): Promise<AnydocPort> {
  const anydoc = await import("@firecrawl/anydoc");
  return {
    formatFromBytes(bytes) {
      return anydoc.formatFromBytes(bytes);
    },
    formatFromExtension(extension) {
      return anydoc.formatFromExtension(extension);
    },
    async toDocument(bytes, format) {
      return (await anydoc.toDocument(bytes, format as never)) as AnydocDocument;
    },
  };
}

async function createOcrPort(): Promise<OcrPort> {
  const lightOcr = await import("@arcships/light-ocr");
  const engine = await lightOcr.createEngine();
  return {
    async recognizeEncoded(bytes, options) {
      const result = await engine.recognizeEncoded(bytes, { signal: options?.signal });
      return { lines: result.lines };
    },
    recognizeDocument(bytes, options) {
      return lightOcr.recognizeDocument(bytes, {
        engine,
        pageRange: options?.pageRange,
        signal: options?.signal,
      });
    },
    async close() {
      await engine.close();
    },
  };
}

type InspectorModule = {
  classifyPdfAsync?: (buffer: Buffer) => Promise<Record<string, unknown>>;
  classifyPdf?: (buffer: Buffer) => Record<string, unknown>;
  processPdfAsync?: (buffer: Buffer) => Promise<Record<string, unknown>>;
  processPdf?: (buffer: Buffer) => Record<string, unknown>;
  extractPagesMarkdownAsync?: (buffer: Buffer, pages?: number[]) => Promise<unknown>;
  extractPagesMarkdown?: (buffer: Buffer, pages?: number[]) => unknown;
};

async function createPdfPort(): Promise<PdfInspectorPort> {
  const inspector = (await import("@firecrawl/pdf-inspector")) as unknown as InspectorModule;

  const classifyFn = inspector.classifyPdfAsync ?? wrapSync(inspector.classifyPdf);
  const processFn = inspector.processPdfAsync ?? wrapSync(inspector.processPdf);
  const extractFn = inspector.extractPagesMarkdownAsync ?? wrapSync(inspector.extractPagesMarkdown);

  if (!classifyFn || !processFn) {
    throw new Error("@firecrawl/pdf-inspector does not export classify/process");
  }

  return {
    async classify(bytes) {
      return normalizeClassification(await classifyFn(toBuffer(bytes)));
    },
    async process(bytes) {
      const result = await processFn(toBuffer(bytes));
      return {
        ...normalizeClassification(result),
        markdown: typeof result.markdown === "string" ? result.markdown : null,
      } satisfies PdfProcessResult;
    },
    async extractPagesMarkdown(bytes, pages) {
      if (!extractFn) {
        return null;
      }
      return normalizePages(await extractFn(toBuffer(bytes), pages), pages);
    },
  };
}

async function createImagePort(): Promise<ImageNormalizerPort> {
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default;
  return {
    async toPng(bytes) {
      return sharp(bytes).png().toBuffer();
    },
  };
}

function wrapSync<A extends unknown[], T>(
  fn: ((buffer: Buffer, ...args: A) => T) | undefined,
): ((buffer: Buffer, ...args: A) => Promise<T>) | undefined {
  if (!fn) {
    return undefined;
  }
  return async (buffer, ...args) => fn(buffer, ...args);
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function normalizeClassification(result: Record<string, unknown>): PdfClassification {
  return {
    pdfType: typeof result.pdfType === "string" ? result.pdfType : "Unknown",
    pageCount: typeof result.pageCount === "number" ? result.pageCount : 0,
    pagesNeedingOcr: Array.isArray(result.pagesNeedingOcr)
      ? result.pagesNeedingOcr.filter((page): page is number => typeof page === "number")
      : [],
    hasEncodingIssues: typeof result.hasEncodingIssues === "boolean" ? result.hasEncodingIssues : undefined,
  };
}

function normalizePages(
  result: unknown,
  requested?: number[],
): import("./types.js").ExtractedPdfPage[] | null {
  if (!result) {
    return null;
  }
  // Without a page number on the entry, its position maps to the requested index list (or the document).
  const fallback = (index: number) => requested?.[index] ?? index;
  if (Array.isArray(result)) {
    return result.map((page, index) => pageToExtracted(page, fallback(index)));
  }
  if (typeof result === "object" && result !== null && "pages" in result) {
    const pages = (result as { pages: unknown }).pages;
    if (Array.isArray(pages)) {
      return pages.map((page, index) => pageToExtracted(page, fallback(index)));
    }
  }
  return null;
}

function pageToExtracted(page: unknown, index: number): import("./types.js").ExtractedPdfPage {
  if (typeof page === "string") {
    return { markdown: page, page: index };
  }
  if (page && typeof page === "object") {
    const record = page as { markdown?: unknown; page?: unknown; needsOcr?: unknown };
    return {
      markdown: typeof record.markdown === "string" ? record.markdown : "",
      page: typeof record.page === "number" ? record.page : index,
      needsOcr: typeof record.needsOcr === "boolean" ? record.needsOcr : undefined,
    };
  }
  return { markdown: "", page: index };
}
