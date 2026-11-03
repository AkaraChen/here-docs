import { decodeHtmlBytes, renderHtml } from "../html/render.js";
import type { ConvertDeps, ConvertPart } from "../types.js";
import { wholePart } from "./part.js";

export async function* htmlParts(
  bytes: Uint8Array,
  deps: ConvertDeps,
  signal?: AbortSignal,
): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  const { markdown, warnings } = await renderHtml(decodeHtmlBytes(bytes), deps, signal);
  yield wholePart(markdown, warnings);
}
