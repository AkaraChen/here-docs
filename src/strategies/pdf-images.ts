import { linesToMarkdown } from "../markdown/from-ocr.js";
import { recognizeDocumentPages } from "../ocr.js";
import type { ConvertDeps, ImageText, OcrLine, OcrPdfRender, PdfPageItem } from "../types.js";

/** Images smaller than this, in PDF points, are logos, bullets, and rules rather than pictures of text. */
const MIN_IMAGE_WIDTH = 72;
const MIN_IMAGE_HEIGHT = 24;

/** An OCR line that covers more than this share of its area with a native text run is that text, not the image's. */
const NATIVE_TEXT_OVERLAP = 0.3;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function imagesWorthOcr(items: readonly PdfPageItem[]): PdfPageItem[] {
  return items.filter(
    (item) => item.kind === "image" && item.width >= MIN_IMAGE_WIDTH && item.height >= MIN_IMAGE_HEIGHT,
  );
}

/**
 * OCRs a text page and keeps, per image, the lines that lie inside the image and are not native text drawn over it.
 * Images come back in the order given; images without recognized text are left out. Throws when OCR fails.
 */
export async function recognizeImageText(
  bytes: Uint8Array,
  deps: ConvertDeps,
  index: number,
  items: readonly PdfPageItem[],
  signal: AbortSignal | undefined,
): Promise<ImageText[]> {
  const images = imagesWorthOcr(items);
  if (images.length === 0) {
    return [];
  }
  const page = index + 1;
  const pages = await recognizeDocumentPages(deps.ocr, bytes, { start: page, end: page }, signal);
  const texts = items.filter((item) => item.kind === "text").map(textBounds);
  const lines = new Map<PdfPageItem, OcrLine[]>();
  for (const ocrPage of pages) {
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

/**
 * An OCR line's box in PDF points (origin bottom left), or null when it cannot be placed: no box, or a page with a
 * `/Rotate`, whose rendered pixels do not map onto unrotated page space without the extractor's own convention.
 */
function lineBounds(line: OcrLine, render: OcrPdfRender): Bounds | null {
  if (!line.box || line.box.length === 0 || render.rotation % 360 !== 0 || render.scale <= 0) {
    return null;
  }
  const xs = line.box.map((point) => render.cropBox.x + point.x / render.scale);
  const ys = line.box.map((point) => render.cropBox.y + render.cropBox.height - point.y / render.scale);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A text run's box: `y` is its baseline, so descenders reach a quarter of the font size below it. */
function textBounds(text: PdfPageItem): Bounds {
  return { x: text.x, y: text.y - text.height / 4, width: text.width, height: (text.height * 5) / 4 };
}

function containsCenter(image: PdfPageItem, bounds: Bounds): boolean {
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  return x >= image.x && x <= image.x + image.width && y >= image.y && y <= image.y + image.height;
}

/** The share of `a`'s area that `b` covers. */
function overlap(a: Bounds, b: Bounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const area = a.width * a.height;
  return width > 0 && height > 0 && area > 0 ? (width * height) / area : 0;
}
