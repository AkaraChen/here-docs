import type { ImageText, PdfPageItem } from "../types.js";
import { textPattern } from "./locate.js";

/**
 * Inserts each image's OCR text as its own block after the block that holds the nearest text run above the image,
 * at the start of the page when no text is above it, or at the end when that run cannot be found in the Markdown.
 */
export function insertImageText(markdown: string, items: readonly PdfPageItem[], images: readonly ImageText[]): string {
  const texts = items.filter((item) => item.kind === "text");
  const inserts = images.map((image, order) => ({ at: insertionPoint(markdown, texts, image.image), order, image }));
  let result = markdown;
  // From the end, so earlier offsets stay valid; images at the same point keep their order.
  for (const { at, image } of inserts.sort((a, b) => b.at - a.at || b.order - a.order)) {
    result = insertBlock(result, at, image.markdown);
  }
  return result;
}

function insertionPoint(markdown: string, texts: readonly PdfPageItem[], image: PdfPageItem): number {
  const top = image.y + image.height;
  const above = texts.filter((text) => text.y >= top - 1);
  if (above.length === 0) {
    return 0;
  }
  const overlapping = above.filter((text) => text.x < image.x + image.width && text.x + text.width > image.x);
  const nearest = (overlapping.length > 0 ? overlapping : above).reduce((best, text) =>
    text.y < best.y || (text.y === best.y && text.x > best.x) ? text : best,
  );
  const end = locateEnd(markdown, nearest.text);
  if (end === null) {
    return markdown.length;
  }
  const blockEnd = markdown.indexOf("\n\n", end);
  return blockEnd === -1 ? markdown.length : blockEnd;
}

/** Where a run's text ends in the Markdown: the whole run, else its last few words, which survive reflow best. */
function locateEnd(markdown: string, run: string): number | null {
  const words = run.trim().split(/\s+/).filter(Boolean);
  for (const text of [words.join(" "), words.slice(-4).join(" ")]) {
    if (!text) {
      continue;
    }
    const match = textPattern(text).exec(markdown);
    if (match) {
      return match.index + match[0].length;
    }
  }
  return null;
}

function insertBlock(markdown: string, at: number, block: string): string {
  if (!markdown.trim()) {
    return block;
  }
  if (at <= 0) {
    return `${block}\n\n${markdown}`;
  }
  if (at >= markdown.length) {
    return `${markdown.trimEnd()}\n\n${block}`;
  }
  return `${markdown.slice(0, at)}\n\n${block}${markdown.slice(at)}`;
}
