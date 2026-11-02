import { ocrErrorCode } from "./errors.js";
import type { OcrLine, OcrPage, OcrPort } from "./types.js";

export async function recognizeWithRetry(
  ocr: OcrPort,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<readonly OcrLine[]> {
  try {
    const result = await ocr.recognizeEncoded(bytes, { signal });
    return result.lines;
  } catch (error) {
    if (signal?.aborted || ocrErrorCode(error) !== "inference_failed") {
      throw error;
    }
    const result = await ocr.recognizeEncoded(bytes, { signal });
    return result.lines;
  }
}

/**
 * Render resolutions to retry at when a page is too large for the OCR engine's per-page pixel limit at its default
 * (150 dpi): halving the resolution quarters the pixels, and 36 dpi is the engine's minimum.
 */
export const FALLBACK_DPI = [75, 36] as const;

export async function recognizeDocumentPages(
  ocr: OcrPort,
  bytes: Uint8Array,
  pageRange?: { start: number; end: number },
  signal?: AbortSignal,
): Promise<OcrPage[]> {
  const resolutions: Array<number | undefined> = [undefined, ...FALLBACK_DPI];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await recognizeDocumentOnce(ocr, bytes, { pageRange, dpi: resolutions[attempt], signal });
    } catch (error) {
      if (signal?.aborted || ocrErrorCode(error) !== "resource_limit_exceeded" || attempt + 1 >= resolutions.length) {
        throw error;
      }
    }
  }
}

async function recognizeDocumentOnce(
  ocr: OcrPort,
  bytes: Uint8Array,
  options: { pageRange?: { start: number; end: number }; dpi?: number; signal?: AbortSignal },
): Promise<OcrPage[]> {
  const pages: OcrPage[] = [];
  try {
    for await (const page of ocr.recognizeDocument(bytes, options)) {
      pages.push(page);
    }
    return pages;
  } catch (error) {
    if (options.signal?.aborted || ocrErrorCode(error) !== "inference_failed") {
      throw error;
    }
    const retried: OcrPage[] = [];
    for await (const page of ocr.recognizeDocument(bytes, options)) {
      retried.push(page);
    }
    return retried;
  }
}
