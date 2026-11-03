import { ocrErrorCode } from "./errors.js";
import type { ImageNormalizerPort, OcrLine, OcrPage, OcrPort } from "./types.js";

/**
 * OCRs one encoded image. An inference failure is retried once; an image above the engine's size limits
 * (a 45-megapixel HDR photo, a 600 dpi poster scan) is shrunk and retried when `images` can shrink it.
 */
export async function recognizeWithRetry(
  ocr: OcrPort,
  bytes: Uint8Array,
  signal?: AbortSignal,
  images?: ImageNormalizerPort,
): Promise<readonly OcrLine[]> {
  try {
    const result = await ocr.recognizeEncoded(bytes, { signal });
    return result.lines;
  } catch (error) {
    const code = ocrErrorCode(error);
    if (signal?.aborted || (code !== "inference_failed" && !(code === "resource_limit_exceeded" && images?.fitForOcr))) {
      throw error;
    }
    const retry = code === "resource_limit_exceeded" && images?.fitForOcr ? await images.fitForOcr(bytes) : bytes;
    const result = await ocr.recognizeEncoded(retry, { signal });
    return result.lines;
  }
}

export async function recognizeDocumentPages(
  ocr: OcrPort,
  bytes: Uint8Array,
  pageRange?: { start: number; end: number },
  signal?: AbortSignal,
): Promise<OcrPage[]> {
  const options = { pageRange, signal };
  const pages: OcrPage[] = [];
  try {
    for await (const page of ocr.recognizeDocument(bytes, options)) {
      pages.push(page);
    }
    return pages;
  } catch (error) {
    if (signal?.aborted || ocrErrorCode(error) !== "inference_failed") {
      throw error;
    }
    const retried: OcrPage[] = [];
    for await (const page of ocr.recognizeDocument(bytes, options)) {
      retried.push(page);
    }
    return retried;
  }
}
