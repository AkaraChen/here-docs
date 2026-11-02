import type { PdfPageItem } from "../types.js";
import { isCjk, textPattern } from "./locate.js";

/** Link schemes that become Markdown links. Anything else (javascript:, file:, data:, ...) stays plain text. */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Turns a page's link annotations into Markdown links. The anchor is the text under the annotation's rectangle,
 * found in the page's Markdown and wrapped in place. A safe link whose anchor cannot be located is appended to the
 * page as an autolink, so its URL is not lost. Links the Markdown already has (the extractor links visible URLs)
 * are left alone.
 */
export function spliceLinks(markdown: string, items: readonly PdfPageItem[]): string {
  const texts = items.filter((item) => item.kind === "text");
  const links = items
    .filter((item) => item.kind === "link" && safeUrl(item.url) !== null)
    .sort(readingOrder);
  if (links.length === 0) {
    return markdown;
  }

  let result = markdown;
  const linked: Array<[number, number]> = [];
  const placed = new Set<string>();
  for (const match of markdown.matchAll(EXISTING_LINK)) {
    linked.push([match.index, match.index + match[0].length]);
    placed.add(sameUrl(match[1] ?? match[2] ?? ""));
  }
  let cursor = 0;
  const unplaced: string[] = [];
  for (const link of links) {
    const url = safeUrl(link.url)!;
    if (placed.has(sameUrl(url))) {
      continue;
    }
    const anchor = anchorText(link, texts);
    const match = anchor ? findAnchor(result, anchor, cursor, linked) : null;
    if (!match) {
      unplaced.push(url);
      continue;
    }
    placed.add(sameUrl(url));
    const [start, end] = match;
    const replacement = markdownLink(result.slice(start, end), url);
    result = result.slice(0, start) + replacement + result.slice(end);
    const delta = replacement.length - (end - start);
    for (const range of linked) {
      if (range[0] >= end) {
        range[0] += delta;
        range[1] += delta;
      }
    }
    linked.push([start, start + replacement.length]);
    cursor = start + replacement.length;
  }

  const trailing = [...new Set(unplaced)].filter((url) => !placed.has(sameUrl(url)));
  if (trailing.length === 0) {
    return result;
  }
  const appendix = trailing.map((url) => `<${url}>`).join("\n");
  return result.trim() ? `${result.trimEnd()}\n\n${appendix}` : appendix;
}

/** Markdown links and autolinks: `[text](url)` (group 1) and `<scheme:...>` (group 2). */
const EXISTING_LINK = /\[[^\]\n]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)|<([a-z][a-z0-9+.-]*:[^>\s]+)>/gi;

/** A comparison key under which `https://a.b/`, `https://a.b`, and `mailto:x@a.b` vs `x@a.b` are the same link. */
function sameUrl(url: string): string {
  return url.trim().replace(/^mailto:/i, "").replace(/\/+$/, "").toLowerCase();
}

/** The URL in a form that is safe to put in Markdown, or null for unsafe or malformed targets. */
function safeUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) {
    return null;
  }
  return url.trim().replace(/[\s<>()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

function markdownLink(anchor: string, url: string): string {
  if (sameUrl(anchor.replace(/\\(.)/g, "$1")) === sameUrl(url)) {
    return `<${url}>`;
  }
  return `[${anchor.replace(/(?<!\\)([[\]])/g, "\\$1")}](${url})`;
}

/** Top to bottom, then left to right, in PDF space (origin bottom-left). */
function readingOrder(a: PdfPageItem, b: PdfPageItem): number {
  return b.y + b.height - (a.y + a.height) || a.x - b.x;
}

/**
 * The words of the text items under a link's rectangle. Text items are whole runs, so each character's position is
 * estimated from proportional advance widths, and the anchor is snapped to whole words.
 */
function anchorText(link: PdfPageItem, texts: readonly PdfPageItem[]): string | null {
  const pieces: string[] = [];
  for (const text of [...texts].sort(readingOrder)) {
    if (!verticallyOverlaps(text, link)) {
      continue;
    }
    const piece = wordsWithin(text, link.x, link.x + link.width);
    if (piece) {
      pieces.push(piece);
    }
  }
  // Sentence punctuation next to a link is rarely part of it.
  const anchor = pieces.join(" ").trim().replace(/^[("'“‘\s]+|[.,;:!?)"'”’\s]+$/gu, "");
  return anchor.length > 0 ? anchor : null;
}

function verticallyOverlaps(text: PdfPageItem, link: PdfPageItem): boolean {
  const top = Math.min(text.y + text.height, link.y + link.height);
  const bottom = Math.max(text.y, link.y);
  return top - bottom >= Math.min(text.height, link.height) / 2;
}

function wordsWithin(text: PdfPageItem, left: number, right: number): string | null {
  const chars = [...text.text];
  const weights = chars.map(advanceWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0 || text.width <= 0) {
    return null;
  }
  let position = text.x;
  const inside = chars.map((_, index) => {
    const advance = (weights[index]! / total) * text.width;
    const center = position + advance / 2;
    position += advance;
    return center >= left && center <= right;
  });

  // A word belongs to the anchor when most of its characters lie under the link.
  let first = -1;
  let last = -1;
  for (const { start, end } of words(chars)) {
    const covered = inside.slice(start, end).filter(Boolean).length;
    if (covered * 2 >= end - start) {
      first = first === -1 ? start : first;
      last = end;
    }
  }
  return first === -1 ? null : chars.slice(first, last).join("");
}

/** Runs of non-space characters; each CJK character is a word of its own. */
function words(chars: readonly string[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start = -1;
  chars.forEach((char, index) => {
    if (/\s/.test(char)) {
      if (start !== -1) out.push({ start, end: index });
      start = -1;
    } else if (isCjk(char)) {
      if (start !== -1) out.push({ start, end: index });
      out.push({ start: index, end: index + 1 });
      start = -1;
    } else if (start === -1) {
      start = index;
    }
  });
  if (start !== -1) out.push({ start, end: chars.length });
  return out;
}

/** Finds `anchor` in `markdown` at or after `cursor` (else anywhere), outside ranges already linked. */
function findAnchor(
  markdown: string,
  anchor: string,
  cursor: number,
  linked: ReadonlyArray<readonly [number, number]>,
): [number, number] | null {
  const pattern = textPattern(anchor);
  const candidates: Array<[number, number]> = [];
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!linked.some(([from, to]) => start < to && end > from) && balancedTags(match[0])) {
      candidates.push([start, end]);
    }
  }
  return candidates.find(([start]) => start >= cursor) ?? candidates[0] ?? null;
}

/** Whether wrapping `slice` in a link keeps its inline HTML tags (such as `<u>`) properly nested. */
function balancedTags(slice: string): boolean {
  const open: string[] = [];
  for (const [, closing, name] of slice.matchAll(/<(\/?)([a-z]+)>/g)) {
    if (!closing) {
      open.push(name!);
    } else if (open.pop() !== name) {
      return false;
    }
  }
  return open.length === 0;
}

/** Relative advance width of a character: Helvetica's for printable ASCII, a full em for CJK, otherwise average. */
function advanceWeight(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) {
    return HELVETICA_WIDTHS[code - 32]!;
  }
  return isCjk(char) ? 1000 : 556;
}

/** Helvetica advance widths (1/1000 em) for printable ASCII, used as a generic proportional-font estimate. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];
