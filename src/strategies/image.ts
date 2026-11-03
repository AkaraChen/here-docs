import { WarningCode } from "../errors.js";
import { linesToMarkdown, pageMarkdown } from "../markdown/from-ocr.js";
import { toRasterBytes } from "../normalize-image.js";
import { imageText } from "../assets.js";
import { recognizeWithRetry } from "../ocr.js";
import type { ConvertDeps, ConvertPart, ImageFormat } from "../types.js";
import { wholePart } from "./part.js";

export async function* imageParts(
  bytes: Uint8Array,
  format: ImageFormat,
  deps: ConvertDeps,
  signal?: AbortSignal,
): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  const pageCount = format === "tiff" ? await countPages(bytes, deps) : 1;
  signal?.throwIfAborted();
  if (pageCount > 1) {
    // A multi-page TIFF is a paged input: each page is decoded and OCR'd only when requested.
    for (let index = 0; index < pageCount; index += 1) {
      yield await tiffPage(bytes, deps, index, pageCount, signal);
    }
    return;
  }

  let raster: Uint8Array;
  if (format === "svg") {
    // SVG text is read from the drawing; only text-less drawings are rendered and OCR'd.
    try {
      yield wholePart(await imageText(bytes, format, deps, signal), []);
    } catch (error) {
      signal?.throwIfAborted();
      yield wholePart("", [{ code: WarningCode.transcodeFailed, message: error instanceof Error ? error.message : "SVG could not be rendered" }]);
    }
    return;
  }
  try {
    raster = await toRasterBytes(bytes, format, deps.images);
  } catch (error) {
    signal?.throwIfAborted();
    yield wholePart("", [
      {
        code: WarningCode.transcodeFailed,
        message: error instanceof Error ? error.message : "image transcode failed",
      },
    ]);
    return;
  }

  signal?.throwIfAborted();
  let markdown: string;
  try {
    markdown = linesToMarkdown(await recognizeWithRetry(deps.ocr, raster, signal, deps.images));
  } catch (error) {
    signal?.throwIfAborted();
    yield wholePart("", [
      {
        code: WarningCode.ocrFailed,
        message: error instanceof Error ? error.message : "image OCR failed",
      },
    ]);
    return;
  }
  yield wholePart(markdown, []);
}

async function countPages(bytes: Uint8Array, deps: ConvertDeps): Promise<number> {
  try {
    return Math.max(1, (await deps.images.pageCount?.(bytes)) ?? 1);
  } catch {
    // An unreadable header is reported by the single-image path below.
    return 1;
  }
}

async function tiffPage(
  bytes: Uint8Array,
  deps: ConvertDeps,
  index: number,
  pageCount: number,
  signal: AbortSignal | undefined,
): Promise<ConvertPart> {
  const page = index + 1;
  signal?.throwIfAborted();
  let raster: Uint8Array;
  try {
    raster = await toRasterBytes(bytes, "tiff", deps.images, index);
  } catch (error) {
    signal?.throwIfAborted();
    return emptyPage(page, pageCount, WarningCode.transcodeFailed, error, "transcode failed");
  }
  signal?.throwIfAborted();
  try {
    const lines = await recognizeWithRetry(deps.ocr, raster, signal, deps.images);
    return { page, pageCount, markdown: pageMarkdown(page, lines).trimEnd(), warnings: [] };
  } catch (error) {
    signal?.throwIfAborted();
    return emptyPage(page, pageCount, WarningCode.ocrFailed, error, "OCR failed");
  }
}

function emptyPage(page: number, pageCount: number, code: string, error: unknown, fallback: string): ConvertPart {
  return {
    page,
    pageCount,
    markdown: "",
    warnings: [{ code, message: `page ${page}: ${error instanceof Error ? error.message : fallback}` }],
  };
}
