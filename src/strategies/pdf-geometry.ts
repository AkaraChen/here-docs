import type { OcrLine, OcrPdfRender, PdfPageItem } from "../types.js";

/** A box in PDF points, origin bottom left. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An OCR line's box in PDF points, or null when it cannot be placed: no box, or a page with a `/Rotate`, whose
 * rendered pixels do not map onto unrotated page space without the extractor's own convention.
 */
export function lineBounds(line: OcrLine, render: OcrPdfRender): Bounds | null {
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
export function textBounds(text: PdfPageItem): Bounds {
  return { x: text.x, y: text.y - text.height / 4, width: text.width, height: (text.height * 5) / 4 };
}

export function containsCenter(outer: Bounds, inner: Bounds): boolean {
  const x = inner.x + inner.width / 2;
  const y = inner.y + inner.height / 2;
  return x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;
}

/** The share of `a`'s area that `b` covers. */
export function overlap(a: Bounds, b: Bounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const area = a.width * a.height;
  return width > 0 && height > 0 && area > 0 ? (width * height) / area : 0;
}
