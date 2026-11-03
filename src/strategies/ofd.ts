import { detectImageFormat } from "../detect.js";
import { WarningCode } from "../errors.js";
import { pageMarkdown } from "../markdown/from-ocr.js";
import { toRasterBytes } from "../normalize-image.js";
import { recognizeWithRetry } from "../ocr.js";
import { layoutLines } from "../ofd/layout.js";
import { openOfd, type OfdDocument } from "../ofd/package.js";
import type { ConvertDeps, ConvertPart, OcrLine, Warning } from "../types.js";
import { wholePart } from "./part.js";

/**
 * One part per OFD page, produced when requested. Text pages yield their text in reading order;
 * pages with images but no text are OCR'd image by image, like scanned PDF pages.
 */
export async function* ofdParts(bytes: Uint8Array, deps: ConvertDeps, signal?: AbortSignal): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  let document: OfdDocument;
  try {
    document = openOfd(bytes);
  } catch (error) {
    yield wholePart("", [{ code: WarningCode.malformed, message: error instanceof Error ? error.message : "unreadable OFD" }], "none");
    return;
  }
  const pageCount = document.pageCount;
  for (let index = 0; index < pageCount; index += 1) {
    signal?.throwIfAborted();
    yield await ofdPage(document, index, pageCount, deps, signal);
  }
}

async function ofdPage(
  document: OfdDocument,
  index: number,
  pageCount: number,
  deps: ConvertDeps,
  signal: AbortSignal | undefined,
): Promise<ConvertPart> {
  const page = index + 1;
  let content: ReturnType<OfdDocument["page"]>;
  try {
    content = document.page(index);
  } catch (error) {
    return {
      page,
      pageCount,
      markdown: "",
      warnings: [{ code: WarningCode.malformed, message: `page ${page}: ${messageOf(error)}` }],
      source: "none",
      ocrReason: null,
    };
  }
  const lines = layoutLines(content.texts);
  if (lines.length > 0) {
    return { page, pageCount, markdown: lines.join("\n"), warnings: [], source: "text", ocrReason: null };
  }
  const warnings: Warning[] = [];
  const recognized: OcrLine[] = [];
  let read = 0;
  const images = [...content.images].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const image of images) {
    signal?.throwIfAborted();
    const data = document.media(image.path);
    if (!data) {
      warnings.push({ code: WarningCode.missingPart, message: `page ${page}: image ${image.path} is missing` });
      continue;
    }
    try {
      // Formats without a known signature (BMP, JBIG2) go to the decoder, which reports what it cannot read.
      const raster = await toRasterBytes(data, detectImageFormat(data) ?? "tiff", deps.images);
      recognized.push(...(await recognizeWithRetry(deps.ocr, raster, signal, deps.images)));
      read += 1;
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push({ code: WarningCode.ocrFailed, message: `page ${page}: image ${image.path}: ${messageOf(error)}` });
    }
  }
  const markdown = images.length > 0 ? pageMarkdown(page, recognized).trimEnd() : "";
  // A page whose every image failed has nothing from OCR; one without images is an empty text page.
  const source = images.length === 0 ? "text" : read > 0 ? "ocr" : "none";
  return { page, pageCount, markdown, warnings, source, ocrReason: null };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
