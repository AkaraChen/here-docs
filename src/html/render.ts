import { recognizeAssets } from "../assets.js";
import { documentToMarkdown } from "../markdown/from-document.js";
import { decodeTextLoose, detectLegacyEncoding } from "../text/decode.js";
import type { ConvertDeps, Warning } from "../types.js";
import { htmlToDocument, type ImageResolver } from "./to-document.js";

/** HTML to Markdown through the shared document model, with embedded images OCR'd in place. */
export async function renderHtml(
  html: string,
  deps: ConvertDeps,
  signal: AbortSignal | undefined,
  resolveImage?: ImageResolver,
): Promise<{ markdown: string; warnings: Warning[]; ocr: boolean }> {
  const document = htmlToDocument(html, { resolveImage });
  const { ocrByAssetId, warnings } = await recognizeAssets(document.assets, deps, signal);
  return { markdown: documentToMarkdown(document, ocrByAssetId), warnings, ocr: ocrByAssetId.size > 0 };
}

/**
 * Decodes HTML bytes: BOM, then valid UTF-8, then the transport charset or `<meta charset>`, then detection
 * on the text without its markup (tags and scripts are ASCII and drown the statistics).
 */
export function decodeHtmlBytes(bytes: Uint8Array, declared?: string): string {
  const charset = declared ?? metaCharset(bytes) ?? (looksLikeUtf8(bytes) ? undefined : detectLegacyEncoding(withoutMarkup(bytes)));
  return decodeTextLoose(bytes, charset);
}

function looksLikeUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function withoutMarkup(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString("latin1")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return new Uint8Array(Buffer.from(text, "latin1"));
}

function metaCharset(bytes: Uint8Array): string | undefined {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 65536)).toString("latin1");
  const match = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head) ?? /<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(head);
  return match?.[1];
}
