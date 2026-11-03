import type { ImageResolver } from "../html/to-document.js";
import { decodeHtmlBytes } from "../html/render.js";
import { leafParts, parseMime, type MimePart } from "./mime.js";
import { normalizeContentId } from "./model.js";

export interface WebArchive {
  html: string;
  resolveImage: ImageResolver;
}

/** Reads a web archive: the root HTML part, and its stored resources keyed by location and Content-ID. */
export function parseMhtml(bytes: Uint8Array): WebArchive | null {
  const root = parseMime(bytes);
  const leaves = leafParts(root);
  const start = normalizeContentId(root.params.start);
  const page =
    (start && leaves.find((part) => normalizeContentId(part.headers.get("content-id")) === start)) ||
    leaves.find((part) => part.contentType === "text/html") ||
    leaves.find((part) => part.contentType === "application/xhtml+xml");
  if (!page) {
    return null;
  }
  const byLocation = new Map<string, MimePart>();
  const byContentId = new Map<string, MimePart>();
  for (const part of leaves) {
    const location = part.headers.get("content-location");
    if (location) {
      byLocation.set(location, part);
    }
    const id = normalizeContentId(part.headers.get("content-id"));
    if (id) {
      byContentId.set(id, part);
    }
  }
  const base = page.headers.get("content-location") ?? root.headers.get("snapshot-content-location");
  const resolveImage: ImageResolver = (src) => {
    const part = src.toLowerCase().startsWith("cid:")
      ? byContentId.get(normalizeContentId(decodeURIComponent(src.slice(4))) ?? "")
      : (byLocation.get(src) ?? byLocation.get(absolute(src, base) ?? ""));
    return part && part !== page ? { data: part.body, mediaType: part.contentType } : null;
  };
  return { html: decodeHtmlBytes(page.body, page.params.charset), resolveImage };
}

function absolute(src: string, base: string | undefined): string | undefined {
  if (!base) {
    return undefined;
  }
  try {
    return new URL(src, base).href;
  } catch {
    return undefined;
  }
}
