import type { ConvertPart, Warning } from "../types.js";

/** The single part of an input that is converted as a whole (office documents, images, unknown bytes). */
export function wholePart(markdown: string, warnings: Warning[]): ConvertPart {
  return { page: null, pageCount: null, markdown: markdown.trimEnd(), warnings };
}
