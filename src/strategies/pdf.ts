import { WarningCode } from "../errors.js";
import { linesToMarkdown, pageMarkdown } from "../markdown/from-ocr.js";
import { recognizeDocumentPages, toOneBasedRanges } from "../ocr.js";
import type { ConvertDeps, ConvertResult, OcrPage, Warning } from "../types.js";

export async function convertPdf(bytes: Uint8Array, deps: ConvertDeps): Promise<ConvertResult> {
  let classification;
  try {
    classification = await deps.pdf.classify(bytes);
  } catch (error) {
    return {
      markdown: "",
      warnings: [
        {
          code: WarningCode.malformed,
          message: error instanceof Error ? error.message : "PDF classification failed",
        },
      ],
    };
  }

  const type = classification.pdfType.toLowerCase();
  if (type === "scanned" || type === "imagebased" || type === "image_based") {
    return ocrWholePdf(bytes, deps);
  }

  const pageCount = Math.max(0, classification.pageCount);
  const needingOcr = new Set(classification.pagesNeedingOcr.filter((page) => page >= 0));
  const extracted = await safeExtractPages(bytes, deps);
  const warnings: Warning[] = [];

  if (type === "textbased" || type === "text_based") {
    if (needingOcr.size === 0 && extracted.whole && !classification.hasEncodingIssues) {
      return { markdown: ensureNewline(extracted.whole), warnings };
    }
  }

  const pages: string[] = Array.from({ length: Math.max(pageCount, extracted.pages.length) }, () => "");
  if (extracted.pages.length > 0) {
    extracted.pages.forEach((page, index) => {
      const slot = page.page ?? index;
      pages[slot] = page.markdown;
      if (page.needsOcr) {
        needingOcr.add(slot);
      }
    });
  } else if (extracted.whole && needingOcr.size === 0 && !classification.hasEncodingIssues) {
    return { markdown: ensureNewline(extracted.whole), warnings };
  }

  if (classification.hasEncodingIssues) {
    for (let index = 0; index < pages.length; index += 1) {
      if (!pages[index] || pages[index]!.trim().length === 0) {
        needingOcr.add(index);
      }
    }
  }

  if (needingOcr.size === 0 && extracted.whole) {
    return { markdown: ensureNewline(extracted.whole), warnings };
  }

  const ocrPages = await ocrSelectedPages(bytes, deps, [...needingOcr], warnings);
  for (const page of ocrPages) {
    const zeroBased = page.index;
    if (zeroBased >= 0 && zeroBased < pages.length) {
      pages[zeroBased] = pageMarkdown(zeroBased + 1, page.lines).trimEnd();
    }
  }

  const merged = pages
    .map((page, index) => page.trim() || (needingOcr.has(index) ? `## Page ${index + 1}` : ""))
    .filter((page) => page.length > 0)
    .join("\n\n");

  if (merged.length === 0 && extracted.whole) {
    return { markdown: ensureNewline(extracted.whole), warnings };
  }

  return { markdown: merged ? `${merged}\n` : "", warnings };
}

async function ocrWholePdf(bytes: Uint8Array, deps: ConvertDeps): Promise<ConvertResult> {
  try {
    const pages = await recognizeDocumentPages(deps.ocr, bytes);
    const markdown = pages
      .map((page) => pageMarkdown(page.index + 1, page.lines).trimEnd())
      .filter((page) => page.length > 0)
      .join("\n\n");
    if (markdown.length === 0) {
      const lines = pages.flatMap((page) => page.lines);
      return { markdown: linesToMarkdown(lines), warnings: [] };
    }
    return { markdown: `${markdown}\n`, warnings: [] };
  } catch (error) {
    return {
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

async function ocrSelectedPages(
  bytes: Uint8Array,
  deps: ConvertDeps,
  zeroBasedPages: number[],
  warnings: Warning[],
): Promise<Array<{ index: number; lines: OcrPage["lines"] }>> {
  const collected: Array<{ index: number; lines: OcrPage["lines"] }> = [];
  for (const range of toOneBasedRanges(zeroBasedPages)) {
    try {
      const pages = await recognizeDocumentPages(deps.ocr, bytes, range);
      for (const page of pages) {
        collected.push({
          index: page.index,
          lines: page.lines,
        });
      }
    } catch (error) {
      warnings.push({
        code: WarningCode.pdfPageOcrFailed,
        message:
          error instanceof Error
            ? `pages ${range.start}-${range.end}: ${error.message}`
            : `pages ${range.start}-${range.end}: OCR failed`,
      });
    }
  }
  return collected;
}

async function safeExtractPages(
  bytes: Uint8Array,
  deps: ConvertDeps,
): Promise<{ pages: import("../types.js").ExtractedPdfPage[]; whole: string | null }> {
  try {
    const pages = await deps.pdf.extractPagesMarkdown(bytes);
    if (pages && pages.length > 0) {
      return { pages, whole: null };
    }
  } catch {
    // Fall back to whole-document extraction.
  }
  try {
    const processed = await deps.pdf.process(bytes);
    return {
      pages: [],
      whole: processed.markdown,
    };
  } catch {
    return { pages: [], whole: null };
  }
}

function ensureNewline(markdown: string): string {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}
