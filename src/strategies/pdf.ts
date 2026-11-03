import { WarningCode } from "../errors.js";
import { pageMarkdown } from "../markdown/from-ocr.js";
import { insertImageText } from "../markdown/pdf-images.js";
import { spliceLinks } from "../markdown/pdf-links.js";
import { removeRuns } from "../markdown/remove-runs.js";
import { recognizeDocumentPages } from "../ocr.js";
import { imagesWorthOcr, imageText } from "./pdf-images.js";
import { hidesOptionalContent, unseenRuns } from "./pdf-layers.js";
import type {
  ConvertDeps,
  ConvertPart,
  ExtractedPdfPage,
  OcrPage,
  OcrReason,
  PartSource,
  PdfClassification,
  PdfPageItem,
  Warning,
} from "../types.js";

/**
 * pdf-inspector pays for a whole-document parse on every page-extraction call, however few pages it is asked for. Text
 * is therefore extracted in two calls: a small first batch, so stopping early stays cheap, then every remaining page.
 */
const FIRST_BATCH = 8;
/** If extracting the rest at once fails, it is retried this many pages at a time, so a bad page costs only its chunk. */
const RETRY_CHUNK = 64;
/** Positioned items are read this many pages at a time: the call is synchronous and its cost grows with the pages. */
const ITEMS_CHUNK = 64;

/**
 * Yields one part per page, in page order. Each page is extracted or OCR'd only when the consumer asks
 * for it, so stopping early skips the remaining work.
 */
export async function* pdfParts(
  bytes: Uint8Array,
  deps: ConvertDeps,
  signal?: AbortSignal,
): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  let classification: PdfClassification;
  try {
    classification = await deps.pdf.classify(bytes);
  } catch (error) {
    signal?.throwIfAborted();
    yield {
      page: null,
      pageCount: null,
      markdown: "",
      warnings: [
        {
          code: WarningCode.malformed,
          message: error instanceof Error ? error.message : "PDF classification failed",
        },
      ],
      source: "none",
      ocrReason: null,
    };
    return;
  }
  signal?.throwIfAborted();

  const pageCount = Math.max(0, classification.pageCount);
  const type = classification.pdfType.toLowerCase();
  if (type === "scanned" || type === "imagebased" || type === "image_based") {
    if (pageCount === 0) {
      yield* ocrWholePdf(bytes, deps, signal);
      return;
    }
    for (let index = 0; index < pageCount; index += 1) {
      yield await ocrPage(bytes, deps, index, pageCount, "scanned-document", signal);
    }
    return;
  }

  const needingOcr = new Set(classification.pagesNeedingOcr.filter((page) => page >= 0));
  const checkLayers = hidesOptionalContent(bytes);
  const first = range(0, Math.min(FIRST_BATCH, pageCount));
  const firstExtracted = await extractPages(bytes, deps, first, signal);
  if (!firstExtracted) {
    // Per-page extraction is unavailable for this document: fall back to one whole-document part.
    yield* wholeDocument(bytes, deps, pageCount, needingOcr, signal);
    return;
  }
  const context = { bytes, deps, pageCount, needingOcr, checkLayers, signal };
  yield* extractedParts(context, first, firstExtracted);
  if (pageCount <= first.length) {
    return;
  }

  const rest = range(first.length, pageCount);
  const restExtracted = await extractPages(bytes, deps, rest, signal);
  if (restExtracted) {
    for (let start = 0; start < rest.length; start += ITEMS_CHUNK) {
      yield* extractedParts(context, rest.slice(start, start + ITEMS_CHUNK), restExtracted);
    }
    return;
  }
  for (let start = 0; start < rest.length; start += RETRY_CHUNK) {
    const chunk = rest.slice(start, start + RETRY_CHUNK);
    // A chunk that fails to extract again keeps its pages by OCR instead of dropping them.
    yield* extractedParts(context, chunk, await extractPages(bytes, deps, chunk, signal));
  }
}

interface PdfContext {
  bytes: Uint8Array;
  deps: ConvertDeps;
  pageCount: number;
  needingOcr: ReadonlySet<number>;
  checkLayers: boolean;
  signal: AbortSignal | undefined;
}

/**
 * Yields the parts of `indexes` from their extraction (null when it failed). Positioned items are read once for the
 * text pages among them; OCR runs per page, when the page is requested.
 */
async function* extractedParts(
  { bytes, deps, pageCount, needingOcr, checkLayers, signal }: PdfContext,
  indexes: number[],
  extracted: ReadonlyMap<number, ExtractedPdfPage> | null,
): AsyncGenerator<ConvertPart> {
  const reasons = indexes.map((index) => ocrReasonFor(extracted?.get(index), extracted !== null, needingOcr.has(index)));
  const items = await pageItems(
    bytes,
    deps,
    indexes.filter((_, position) => reasons[position] === null),
    signal,
  );
  for (const [position, index] of indexes.entries()) {
    signal?.throwIfAborted();
    const reason = reasons[position];
    const markdown = extracted?.get(index)?.markdown.trim() ?? "";
    yield reason
      ? await ocrPage(bytes, deps, index, pageCount, reason, signal)
      : await textPage(bytes, deps, index, pageCount, markdown, items.get(index) ?? [], checkLayers, signal);
  }
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}

/** Why a page of a text or mixed document goes to OCR, or null when its extracted text is kept. */
function ocrReasonFor(
  page: ExtractedPdfPage | undefined,
  batchExtracted: boolean,
  classifierFlagged: boolean,
): OcrReason | null {
  if (!batchExtracted) {
    // A batch that failed to extract keeps its pages by OCR instead of dropping them.
    return "extraction-failed";
  }
  if (page?.ocrReason === "suspected_garbled_text") {
    return "garbled-text";
  }
  if (classifierFlagged || page?.needsOcr === true) {
    return "page-flagged";
  }
  return null;
}

function textPart(page: number | null, pageCount: number | null, markdown: string): ConvertPart {
  return { page, pageCount, markdown, warnings: [], source: "text", ocrReason: null };
}

async function extractPages(
  bytes: Uint8Array,
  deps: ConvertDeps,
  indexes: number[],
  signal: AbortSignal | undefined,
): Promise<Map<number, ExtractedPdfPage> | null> {
  let pages: ExtractedPdfPage[] | null;
  try {
    pages = await deps.pdf.extractPagesMarkdown(bytes, indexes);
  } catch {
    pages = null;
  }
  signal?.throwIfAborted();
  if (!pages || pages.length === 0) {
    return null;
  }
  return new Map(pages.map((page, position) => [page.page ?? indexes[position] ?? position, page]));
}

/**
 * An extracted page, corrected and enriched from its positioned items. In a document that hides layers by default,
 * text the rendered page does not show is removed. The OCR text of pictures of text is inserted where the pictures
 * are, and link annotations become Markdown links. Both checks share one OCR of the page; if it fails, the page keeps
 * its extracted text with a warning.
 */
async function textPage(
  bytes: Uint8Array,
  deps: ConvertDeps,
  index: number,
  pageCount: number,
  extracted: string,
  items: readonly PdfPageItem[],
  checkLayers: boolean,
  signal: AbortSignal | undefined,
): Promise<ConvertPart> {
  let markdown = extracted;
  let visible = items;
  let source: PartSource = "text";
  const warnings: Warning[] = [];
  const hasImages = imagesWorthOcr(items).length > 0;
  const hasText = items.some((item) => item.kind === "text");
  if (!hasImages && !(checkLayers && hasText)) {
    return { page: index + 1, pageCount, markdown: spliceLinks(markdown, items), warnings, source, ocrReason: null };
  }

  let ocrPages: OcrPage[];
  try {
    ocrPages = await recognizeDocumentPages(deps.ocr, bytes, { start: index + 1, end: index + 1 }, signal);
  } catch (error) {
    signal?.throwIfAborted();
    const reason = error instanceof Error ? error.message : "OCR failed";
    if (checkLayers && hasText) {
      warnings.push({ code: WarningCode.pdfLayerCheckFailed, message: `page ${index + 1}: ${reason}` });
    }
    if (hasImages) {
      warnings.push({ code: WarningCode.pdfImageOcrFailed, message: `page ${index + 1}: ${reason}` });
    }
    return { page: index + 1, pageCount, markdown: spliceLinks(markdown, items), warnings, source, ocrReason: null };
  }

  if (checkLayers) {
    const unseen = unseenRuns(ocrPages, items);
    markdown = removeRuns(markdown, unseen);
    visible = items.filter((item) => !unseen.includes(item));
  }
  const images = hasImages ? imageText(ocrPages, visible) : [];
  if (images.length > 0) {
    markdown = insertImageText(markdown, visible, images);
    source = "mixed";
  }
  return { page: index + 1, pageCount, markdown: spliceLinks(markdown, visible), warnings, source, ocrReason: null };
}

/**
 * Positioned items of the batch's text pages, by page index. They are enrichment: when the engine cannot report
 * them, the pages keep their extracted text without links.
 */
async function pageItems(
  bytes: Uint8Array,
  deps: ConvertDeps,
  indexes: number[],
  signal: AbortSignal | undefined,
): Promise<Map<number, PdfPageItem[]>> {
  const byPage = new Map<number, PdfPageItem[]>();
  if (indexes.length === 0 || !deps.pdf.pageItems) {
    return byPage;
  }
  let items: PdfPageItem[] = [];
  try {
    items = await deps.pdf.pageItems(bytes, indexes);
  } catch {
    // Keep the text without links.
  }
  signal?.throwIfAborted();
  for (const item of items) {
    byPage.set(item.page, [...(byPage.get(item.page) ?? []), item]);
  }
  return byPage;
}

async function* wholeDocument(
  bytes: Uint8Array,
  deps: ConvertDeps,
  pageCount: number,
  needingOcr: ReadonlySet<number>,
  signal: AbortSignal | undefined,
): AsyncGenerator<ConvertPart> {
  let markdown: string | null = null;
  try {
    markdown = (await deps.pdf.process(bytes)).markdown;
  } catch {
    // Nothing extractable; OCR'd pages below may still produce a manuscript.
  }
  signal?.throwIfAborted();
  if (markdown?.trim()) {
    yield textPart(null, pageCount || null, markdown.trimEnd());
  }
  for (const index of [...needingOcr].sort((a, b) => a - b)) {
    if (index < pageCount) {
      yield await ocrPage(bytes, deps, index, pageCount, "page-flagged", signal);
    }
  }
}

async function ocrPage(
  bytes: Uint8Array,
  deps: ConvertDeps,
  index: number,
  pageCount: number,
  ocrReason: OcrReason,
  signal: AbortSignal | undefined,
): Promise<ConvertPart> {
  const page = index + 1;
  // One page per OCR request: the OCR engine's per-request page and pixel limits then never drop a long scan.
  try {
    const pages = await recognizeDocumentPages(deps.ocr, bytes, { start: page, end: page }, signal);
    const lines = pages.flatMap((p) => p.lines);
    return { page, pageCount, markdown: pageMarkdown(page, lines).trimEnd(), warnings: [], source: "ocr", ocrReason };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      page,
      pageCount,
      markdown: "",
      warnings: [
        {
          code: WarningCode.pdfPageOcrFailed,
          message: `page ${page}: ${error instanceof Error ? error.message : "OCR failed"}`,
        },
      ],
      source: "none",
      ocrReason,
    };
  }
}

/** A scanned PDF whose page count the classifier could not read: let the OCR engine walk the pages. */
async function* ocrWholePdf(
  bytes: Uint8Array,
  deps: ConvertDeps,
  signal: AbortSignal | undefined,
): AsyncGenerator<ConvertPart> {
  try {
    for await (const page of deps.ocr.recognizeDocument(bytes, { signal })) {
      yield {
        page: page.index + 1,
        pageCount: null,
        markdown: pageMarkdown(page.index + 1, page.lines).trimEnd(),
        warnings: [],
        source: "ocr",
        ocrReason: "scanned-document",
      };
    }
  } catch (error) {
    signal?.throwIfAborted();
    yield {
      page: null,
      pageCount: null,
      markdown: "",
      warnings: [
        {
          code: WarningCode.ocrFailed,
          message: error instanceof Error ? error.message : "PDF OCR failed",
        },
      ],
      source: "none",
      ocrReason: "scanned-document",
    };
  }
}
