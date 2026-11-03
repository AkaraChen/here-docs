import { mimeKind } from "../detect.js";
import { WarningCode } from "../errors.js";
import { renderHtml } from "../html/render.js";
import { parseEml } from "../message/eml.js";
import { parseMhtml } from "../message/mhtml.js";
import type { ParsedMessage } from "../message/model.js";
import { parseMsg } from "../message/msg.js";
import { renderMessage } from "../message/render.js";
import { sniffText } from "../text/decode.js";
import type { ConvertDeps, ConvertPart, MessageFormat, NestedConvert, Warning } from "../types.js";
import { wholePart } from "./part.js";

export async function* messageParts(
  bytes: Uint8Array,
  format: MessageFormat,
  deps: ConvertDeps,
  signal: AbortSignal | undefined,
  nested: NestedConvert | null,
): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  if (format === "mhtml") {
    yield await webArchive(bytes, deps, signal);
    return;
  }
  const warnings: Warning[] = [];
  let message: ParsedMessage;
  try {
    if (format === "msg") {
      const parsed = parseMsg(bytes);
      message = await unwrapSigned(parsed.message);
      warnings.push(...parsed.warnings.map((text) => ({ code: WarningCode.skippedAsset, message: text })));
    } else {
      message = await parseEml(bytes);
    }
  } catch (error) {
    signal?.throwIfAborted();
    yield wholePart("", [{ code: WarningCode.malformed, message: error instanceof Error ? error.message : "unreadable message" }], "none");
    return;
  }
  signal?.throwIfAborted();
  const rendered = await renderMessage(message, deps, signal, nested);
  yield wholePart(rendered.markdown, [...warnings, ...rendered.warnings], rendered.ocr ? "mixed" : "text");
}

/**
 * Outlook stores a clear-signed S/MIME mail as an `smime.p7m` attachment holding the whole MIME body;
 * its text and attachments are the message's real content. Opaque or encrypted `.p7m` (binary) stays an attachment.
 */
async function unwrapSigned(message: ParsedMessage): Promise<ParsedMessage> {
  const index = message.attachments.findIndex(
    (attachment) => (attachment.filename ?? "").toLowerCase() === "smime.p7m" && mimeKind(sniffText(attachment.content) ?? "") === "eml",
  );
  const signed = message.attachments[index];
  if (!signed) {
    return message;
  }
  const inner = await parseEml(signed.content);
  return {
    ...message,
    html: inner.html ?? message.html,
    text: inner.html ? message.text : (inner.text ?? message.text),
    attachments: [...message.attachments.filter((_, i) => i !== index), ...inner.attachments],
  };
}

async function webArchive(bytes: Uint8Array, deps: ConvertDeps, signal: AbortSignal | undefined): Promise<ConvertPart> {
  let archive: ReturnType<typeof parseMhtml>;
  try {
    archive = parseMhtml(bytes);
  } catch (error) {
    return wholePart("", [{ code: WarningCode.malformed, message: error instanceof Error ? error.message : "unreadable web archive" }], "none");
  }
  if (!archive) {
    return wholePart("", [{ code: WarningCode.malformed, message: "web archive has no HTML page" }], "none");
  }
  const { markdown, warnings, ocr } = await renderHtml(archive.html, deps, signal, archive.resolveImage);
  return wholePart(markdown, warnings, ocr ? "mixed" : "text");
}
