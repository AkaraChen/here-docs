import { linesToMarkdown } from "../markdown/from-ocr.js";
import type { ImageText, OcrLine, OcrPage, PdfPageItem } from "../types.js";
import { containsCenter, lineBounds, overlap, textBounds } from "./pdf-geometry.js";

/** Images smaller than this, in PDF points, are logos, bullets, and rules rather than pictures of text. */
const MIN_IMAGE_WIDTH = 72;
const MIN_IMAGE_HEIGHT = 24;

/** An OCR line that covers more than this share of its area with a native text run is that text, not the image's. */
const NATIVE_TEXT_OVERLAP = 0.3;

export function imagesWorthOcr(items: readonly PdfPageItem[]): PdfPageItem[] {
  return items.filter(
    (item) => item.kind === "image" && item.width >= MIN_IMAGE_WIDTH && item.height >= MIN_IMAGE_HEIGHT,
  );
}

/**
 * From a text page's OCR, keeps per image the lines that lie inside the image and are not native text drawn over
 * it. Images come back in the order given; images without recognized text are left out.
 */
export function imageText(ocrPages: readonly OcrPage[], items: readonly PdfPageItem[]): ImageText[] {
  const images = imagesWorthOcr(items);
  const texts = items.filter((item) => item.kind === "text").map(textBounds);
  const lines = new Map<PdfPageItem, OcrLine[]>();
  for (const ocrPage of ocrPages) {
    for (const line of ocrPage.lines) {
      const bounds = ocrPage.render ? lineBounds(line, ocrPage.render) : null;
      if (!bounds) {
        continue;
      }
      const image = images.find((candidate) => containsCenter(candidate, bounds));
      if (!image || texts.some((text) => overlap(bounds, text) > NATIVE_TEXT_OVERLAP)) {
        continue;
      }
      lines.set(image, [...(lines.get(image) ?? []), line]);
    }
  }
  return images.flatMap((image) => {
    const markdown = linesToMarkdown(lines.get(image) ?? []).trimEnd();
    return markdown ? [{ image, markdown }] : [];
  });
}
