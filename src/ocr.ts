import { ocrErrorCode } from "./errors.js";
import type { OcrLine, OcrPage, OcrPort } from "./types.js";

export async function recognizeWithRetry(
  ocr: OcrPort,
  bytes: Uint8Array,
): Promise<readonly OcrLine[]> {
  try {
    const result = await ocr.recognizeEncoded(bytes);
    return result.lines;
  } catch (error) {
    if (ocrErrorCode(error) !== "inference_failed") {
      throw error;
    }
    const result = await ocr.recognizeEncoded(bytes);
    return result.lines;
  }
}

export async function recognizeDocumentPages(
  ocr: OcrPort,
  bytes: Uint8Array,
  pageRange?: { start: number; end: number },
): Promise<OcrPage[]> {
  const pages: OcrPage[] = [];
  try {
    for await (const page of ocr.recognizeDocument(bytes, pageRange ? { pageRange } : undefined)) {
      pages.push(page);
    }
    return pages;
  } catch (error) {
    if (ocrErrorCode(error) !== "inference_failed") {
      throw error;
    }
    const retried: OcrPage[] = [];
    for await (const page of ocr.recognizeDocument(bytes, pageRange ? { pageRange } : undefined)) {
      retried.push(page);
    }
    return retried;
  }
}

export function toOneBasedRanges(zeroBasedPages: number[]): Array<{ start: number; end: number }> {
  const unique = [...new Set(zeroBasedPages)].filter((page) => page >= 0).sort((a, b) => a - b);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const page of unique) {
    const oneBased = page + 1;
    const last = ranges.at(-1);
    if (last && oneBased === last.end + 1) {
      last.end = oneBased;
    } else {
      ranges.push({ start: oneBased, end: oneBased });
    }
  }
  return ranges;
}
