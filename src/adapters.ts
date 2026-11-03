import type { Sharp } from "sharp";
import { decodeBmp, isBmp } from "./bmp.js";
import { detectImageFormat } from "./detect.js";
import { assertNativePackages } from "./natives.js";
import type {
  AnydocDocument,
  AnydocPort,
  ConvertEngine,
  ImageNormalizerPort,
  OcrPort,
  PdfClassification,
  PdfInspectorPort,
  PdfPageItem,
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

/** light-ocr's ceiling for `maxPages`. */
const MAX_DOCUMENT_PAGES = 10_000;

async function createOcrPort(): Promise<OcrPort> {
  const lightOcr = await import("@arcships/light-ocr");
  const engine = await lightOcr.createEngine();
  return {
    async recognizeEncoded(bytes, options) {
      const result = await engine.recognizeEncoded(bytes, { signal: options?.signal });
      return { lines: result.lines };
    },
    async *recognizeDocument(bytes, options) {
      const pages = lightOcr.recognizeDocument(bytes, {
        engine,
        pageRange: options?.pageRange,
        dpi: options?.dpi,
        // The caller already holds the bytes, so a file-size cap protects nothing; it would only fail every page of
        // a large PDF. Page count and total pixels are lifted for the same reason: pages are OCR'd one per request,
        // and a whole-document request must not cut a long scan short. The per-page pixel cap stays.
        maxFileBytes: Math.max(bytes.byteLength, 1),
        maxPages: MAX_DOCUMENT_PAGES,
        maxTotalPixels: Number.MAX_SAFE_INTEGER,
        signal: options?.signal,
      });
      for await (const page of pages) {
        const pdf = page.source.appliedTransforms.pdf;
        yield {
          index: page.index,
          lines: page.lines.map((line) => ({ text: line.text, box: line.box })),
          render: pdf ? { rotation: pdf.rotation, cropBox: pdf.cropBox, scale: pdf.scale } : undefined,
        };
      }
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
  /** Synchronous; `pages` are 1-based. */
  extractTextWithPositions?: (buffer: Buffer, pages?: number[]) => unknown;
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
    async pageItems(bytes, pages) {
      // No async variant exists; its cost scales with the pages requested (a batch at a time).
      const items = inspector.extractTextWithPositions?.(
        toBuffer(bytes),
        pages.map((page) => page + 1),
      );
      return Array.isArray(items) ? items.flatMap(toPageItem) : [];
    },
  };
}

const ITEM_KINDS: Record<string, PdfPageItem["kind"]> = { Text: "text", Link: "link", Image: "image" };

function toPageItem(item: unknown): PdfPageItem[] {
  if (!item || typeof item !== "object") {
    return [];
  }
  const record = item as Record<string, unknown>;
  const kind = typeof record.itemType === "string" ? ITEM_KINDS[record.itemType] : undefined;
  const numbers = [record.page, record.x, record.y, record.width, record.height];
  if (!kind || !numbers.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return [];
  }
  return [
    {
      page: (record.page as number) - 1,
      kind,
      text: typeof record.text === "string" ? record.text : "",
      x: record.x as number,
      y: record.y as number,
      width: record.width as number,
      height: record.height as number,
      url: typeof record.linkUrl === "string" ? record.linkUrl : undefined,
    },
  ];
}

/**
 * The OCR engine reads transparent pixels as black, so dark text on a transparent background disappears.
 * Transparency is flattened onto white, or onto black when the visible content is light (a white logo).
 */
async function opaquePng(image: Sharp): Promise<Buffer> {
  const { hasAlpha } = await image.metadata();
  if (!hasAlpha) {
    return image.png().toBuffer();
  }
  const { data, info } = await image
    .clone()
    .resize(64, 64, { fit: "inside" })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let luminance = 0;
  let visible = 0;
  for (let i = 0; i + 3 < data.length; i += info.channels) {
    if (data[i + 3]! > 127) {
      luminance += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      visible += 1;
    }
  }
  const background = visible > 0 && luminance / visible > 160 ? "#000000" : "#ffffff";
  return image.flatten({ background }).png().toBuffer();
}

/** light-ocr rejects images above about 40 Mi pixels or 10k pixels per side; shrink to safely below that. */
const OCR_MAX_PIXELS = 32_000_000;
const OCR_MAX_SIDE = 8192;

async function createImagePort(): Promise<ImageNormalizerPort> {
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default;
  // Best effort: libtiff tag warnings and truncated scans still yield the readable part of the image.
  const open = (bytes: Uint8Array, page = 0) => sharp(bytes, { page, failOn: "none" });
  return {
    async toPng(bytes, page = 0) {
      if (isBmp(bytes)) {
        const image = decodeBmp(bytes);
        return opaquePng(sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }));
      }
      try {
        return await opaquePng(open(bytes, page));
      } catch (error) {
        // sharp's libheif decodes AV1 only; HEVC-coded HEIC (iPhone photos) needs the WebAssembly decoder.
        if (detectImageFormat(bytes) !== "heic") {
          throw error;
        }
        const image = await decodeHeic(bytes);
        return opaquePng(sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }));
      }
    },
    async pageCount(bytes) {
      return (await open(bytes).metadata()).pages ?? 1;
    },
    async fitForOcr(bytes) {
      const { width = 0, height = 0 } = await open(bytes).metadata();
      const scale = Math.min(1, Math.sqrt(OCR_MAX_PIXELS / Math.max(1, width * height)), OCR_MAX_SIDE / Math.max(1, width, height));
      return open(bytes)
        .resize(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)))
        .png()
        .toBuffer();
    },
  };
}

interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: unknown) => void): void;
  free(): void;
}

/** Decodes the primary image of a HEIF file; grids, overlays, and bursts list other images first. */
async function decodeHeic(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  // A variable specifier keeps the untyped CommonJS module out of type resolution (and out of startup).
  const specifier = "libheif-js/wasm-bundle.js";
  const imported = (await import(specifier)) as { default?: unknown };
  const libheif = (imported.default ?? imported) as { ready: Promise<void>; HeifDecoder: new () => { decode(input: Uint8Array): HeifImage[]; decoder: { delete(): void } } };
  await libheif.ready;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(bytes);
  try {
    const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
    if (!image) {
      throw new Error("HEIF file contains no image");
    }
    const width = image.get_width();
    const height = image.get_height();
    const data = await new Promise<Uint8ClampedArray>((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (result) => {
        if (!result) {
          reject(new Error("HEIF image could not be decoded"));
          return;
        }
        resolve((result as { data: Uint8ClampedArray }).data);
      });
    });
    return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } finally {
    for (const image of images) {
      image.free();
    }
    decoder.decoder.delete();
  }
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
    const record = page as { markdown?: unknown; page?: unknown; needsOcr?: unknown; ocrReason?: unknown };
    return {
      markdown: typeof record.markdown === "string" ? record.markdown : "",
      page: typeof record.page === "number" ? record.page : index,
      needsOcr: typeof record.needsOcr === "boolean" ? record.needsOcr : undefined,
      ocrReason: typeof record.ocrReason === "string" ? record.ocrReason : undefined,
    };
  }
  return { markdown: "", page: index };
}
