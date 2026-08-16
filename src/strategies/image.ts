import { WarningCode } from "../errors.js";
import { linesToMarkdown } from "../markdown/from-ocr.js";
import { toRasterBytes } from "../normalize-image.js";
import { recognizeWithRetry } from "../ocr.js";
import type { ConvertDeps, ConvertResult, ImageFormat } from "../types.js";

export async function convertImage(
  bytes: Uint8Array,
  format: ImageFormat,
  deps: ConvertDeps,
): Promise<ConvertResult> {
  let raster: Uint8Array;
  try {
    raster = await toRasterBytes(bytes, format, deps.images);
  } catch (error) {
    return {
      markdown: "",
      warnings: [
        {
          code: WarningCode.transcodeFailed,
          message: error instanceof Error ? error.message : "image transcode failed",
        },
      ],
    };
  }

  try {
    const lines = await recognizeWithRetry(deps.ocr, raster);
    return { markdown: linesToMarkdown(lines), warnings: [] };
  } catch (error) {
    return {
      markdown: "",
      warnings: [
        {
          code: WarningCode.ocrFailed,
          message: error instanceof Error ? error.message : "image OCR failed",
        },
      ],
    };
  }
}
