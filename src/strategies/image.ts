import { WarningCode } from "../errors.js";
import { linesToMarkdown } from "../markdown/from-ocr.js";
import { toRasterBytes } from "../normalize-image.js";
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
  let raster: Uint8Array;
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
    markdown = linesToMarkdown(await recognizeWithRetry(deps.ocr, raster, signal));
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
