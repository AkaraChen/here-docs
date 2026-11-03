import { WarningCode } from "../errors.js";
import { decodeText } from "../text/decode.js";
import type { ConvertPart } from "../types.js";
import { wholePart } from "./part.js";

/** Plain text and Markdown are the manuscript as decoded: line endings normalized, nothing escaped. */
export async function* textParts(bytes: Uint8Array, signal?: AbortSignal): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  const decoded = decodeText(bytes);
  if (!decoded) {
    yield wholePart("", [{ code: WarningCode.unsupported, message: "the file does not contain readable text" }], "none");
    return;
  }
  yield wholePart(normalizeText(decoded.text), [], "text");
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
}
