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
