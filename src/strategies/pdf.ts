import { WarningCode } from "../errors.js";
import { pageMarkdown } from "../markdown/from-ocr.js";
import { recognizeDocumentPages } from "../ocr.js";
import type { ConvertDeps, ConvertPart, ExtractedPdfPage, PdfClassification } from "../types.js";

/** Text pages are extracted in growing batches so an early stop does not parse the whole document. */
const FIRST_BATCH = 8;
const MAX_BATCH = 64;

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
      yield await ocrPage(bytes, deps, index, pageCount, signal);
    }
    return;
  }

  const needingOcr = new Set(classification.pagesNeedingOcr.filter((page) => page >= 0));
  let batchSize = FIRST_BATCH;
  for (let start = 0; start < pageCount; start += batchSize, batchSize = Math.min(batchSize * 2, MAX_BATCH)) {
    const indexes = Array.from({ length: Math.min(batchSize, pageCount - start) }, (_, i) => start + i);
    const extracted = await extractPages(bytes, deps, indexes, signal);
    if (!extracted && start === 0) {
      // Per-page extraction is unavailable for this document: fall back to one whole-document part.
      yield* wholeDocument(bytes, deps, pageCount, needingOcr, signal);
      return;
    }
    for (const index of indexes) {
      signal?.throwIfAborted();
      const page = extracted?.get(index);
      const markdown = page?.markdown.trim() ?? "";
      // A batch that failed to extract keeps its pages by OCR instead of dropping them.
      const needsOcr =
        !extracted ||
        needingOcr.has(index) ||
        page?.needsOcr === true ||
        (classification.hasEncodingIssues === true && markdown.length === 0);
      yield needsOcr
        ? await ocrPage(bytes, deps, index, pageCount, signal)
        : { page: index + 1, pageCount, markdown, warnings: [] };
    }
  }
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
    yield { page: null, pageCount: pageCount || null, markdown: markdown.trimEnd(), warnings: [] };
  }
  for (const index of [...needingOcr].sort((a, b) => a - b)) {
    if (index < pageCount) {
      yield await ocrPage(bytes, deps, index, pageCount, signal);
    }
  }
}

async function ocrPage(
  bytes: Uint8Array,
  deps: ConvertDeps,
  index: number,
  pageCount: number,
  signal: AbortSignal | undefined,
): Promise<ConvertPart> {
  const page = index + 1;
  // One page per OCR request: the OCR engine's per-request page and pixel limits then never drop a long scan.
  try {
    const pages = await recognizeDocumentPages(deps.ocr, bytes, { start: page, end: page }, signal);
    const lines = pages.flatMap((p) => p.lines);
    return { page, pageCount, markdown: pageMarkdown(page, lines).trimEnd(), warnings: [] };
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
      yield { page: page.index + 1, pageCount: null, markdown: pageMarkdown(page.index + 1, page.lines).trimEnd(), warnings: [] };
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
    };
  }
}
