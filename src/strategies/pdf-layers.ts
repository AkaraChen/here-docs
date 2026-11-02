import { inflateSync } from "node:zlib";
import type { OcrPage, PdfPageItem } from "../types.js";
import { lineBounds, overlap, textBounds } from "./pdf-geometry.js";

/**
 * Runs smaller than this (font size in points) or with fewer letters and digits than this are always kept: OCR at
 * 150 dpi misses isolated glyphs, bullets, and small chart labels.
 */
const MIN_CHECKED_FONT_SIZE = 8;
const MIN_CHECKED_CHARACTERS = 3;

/**
 * When more than this share of a page's checked runs looks unseen, the run positions and the rendered page disagree
 * (for example content drawn under a rotation the extractor does not report in page space). Nothing is removed then.
 */
const MAX_UNSEEN_SHARE = 0.5;

/**
 * Whether the PDF hides some optional content (layers) by default: its catalog has `/OCProperties` and the default
 * configuration turns groups off (a non-empty `/OFF` array or `/BaseState /OFF`). Looks at the raw bytes and inside
 * compressed object streams, where PDF 1.5+ writers often put the catalog. A cheap byte scan, not a parse: it only
 * decides whether text pages need the visibility check.
 */
export function hidesOptionalContent(bytes: Uint8Array): boolean {
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let declares = raw.includes("/OCProperties");
  let hides = turnsGroupsOff(raw);
  if (declares && hides) {
    return true;
  }
  for (const objects of objectStreams(raw)) {
    declares ||= objects.includes("/OCProperties");
    hides ||= turnsGroupsOff(objects);
    if (declares && hides) {
      return true;
    }
  }
  return false;
}

function turnsGroupsOff(buffer: Buffer): boolean {
  return matchesAfter(buffer, "/OFF", /^\s*\[\s*\d+\s+\d+\s+R/) || matchesAfter(buffer, "/BaseState", /^\s*\/OFF\b/);
}

/** Whether some occurrence of `name` is followed by `pattern` (checked on the next few bytes). */
function matchesAfter(buffer: Buffer, name: string, pattern: RegExp): boolean {
  for (let at = buffer.indexOf(name); at !== -1; at = buffer.indexOf(name, at + name.length)) {
    const next = buffer.toString("latin1", at + name.length, at + name.length + 32);
    if (/^[\s[/]/.test(next) && pattern.test(next)) {
      return true;
    }
  }
  return false;
}

/** The inflated contents of every Flate-compressed object stream (`/Type /ObjStm`) in the file. */
function* objectStreams(raw: Buffer): Generator<Buffer> {
  for (let at = raw.indexOf("/ObjStm"); at !== -1; at = raw.indexOf("/ObjStm", at + 7)) {
    const keyword = raw.indexOf("stream", at);
    if (keyword === -1) {
      return;
    }
    let start = keyword + "stream".length;
    if (raw[start] === 0x0d) start += 1;
    if (raw[start] === 0x0a) start += 1;
    const end = raw.indexOf("endstream", start);
    if (end === -1) {
      return;
    }
    try {
      yield inflateSync(raw.subarray(start, end));
    } catch {
      // Not Flate, encrypted, or damaged: nothing to learn from it.
    }
  }
}

/**
 * The text runs the rendered page does not show. The renderer honors optional content visibility, so a run that no
 * OCR line touches is not painted: it sits in a hidden layer (or is otherwise invisible). Only runs that can be
 * judged are checked: inside the rendered crop box, at least the checked font size, with a few letters or digits.
 * A page whose OCR saw nothing, whose OCR boxes cannot be mapped (a rotated page), or where most runs look unseen
 * keeps every run.
 */
export function unseenRuns(ocrPages: readonly OcrPage[], items: readonly PdfPageItem[]): PdfPageItem[] {
  const render = ocrPages[0]?.render;
  if (!render || ocrPages.some((page) => !page.render)) {
    return [];
  }
  const seen = ocrPages.flatMap((page) => page.lines.map((line) => lineBounds(line, page.render!)));
  if (seen.length === 0 || seen.some((bounds) => bounds === null)) {
    return [];
  }
  const crop = render.cropBox;
  const checked = items.filter((item) => {
    if (item.kind !== "text" || item.height < MIN_CHECKED_FONT_SIZE) {
      return false;
    }
    if ((item.text.match(/[\p{L}\p{N}]/gu) ?? []).length < MIN_CHECKED_CHARACTERS) {
      return false;
    }
    const box = textBounds(item);
    return box.x >= crop.x && box.y >= crop.y && box.x + box.width <= crop.x + crop.width && box.y + box.height <= crop.y + crop.height;
  });
  const unseen = checked.filter((item) => !seen.some((bounds) => overlap(textBounds(item), bounds!) > 0));
  return unseen.length > checked.length * MAX_UNSEEN_SHARE ? [] : unseen;
}
