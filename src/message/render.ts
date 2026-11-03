import { WarningCode } from "../errors.js";
import { renderHtml } from "../html/render.js";
import { documentToMarkdown } from "../markdown/from-document.js";
import { normalizeText } from "../strategies/text.js";
import type { AnydocBlock, AnydocInline, AnydocStyle, ConvertDeps, NestedConvert, Warning } from "../types.js";
import { attachmentName, normalizeContentId, type ParsedMessage } from "./model.js";

const PLAIN: AnydocStyle = { bold: false, italic: false, strike: false, code: false };

/** Cryptographic signatures of signed mail are not content. */
const SIGNATURE_TYPES = new Set([
  "application/pkcs7-signature",
  "application/x-pkcs7-signature",
  "application/pgp-signature",
]);
const BOLD: AnydocStyle = { ...PLAIN, bold: true };

/**
 * Subject heading, header fields, body, then each attachment converted under its own heading.
 * `nested` is null when the attachment nesting limit is reached: attachments are then listed only.
 */
export async function renderMessage(
  message: ParsedMessage,
  deps: ConvertDeps,
  signal: AbortSignal | undefined,
  nested: NestedConvert | null,
): Promise<{ markdown: string; warnings: Warning[]; ocr: boolean }> {
  const warnings: Warning[] = [];
  const sections: string[] = [];
  let ocr = false;

  const header: AnydocBlock[] = [];
  if (message.subject) {
    header.push({ kind: "heading", level: 1, content: [text(message.subject)] });
  }
  const candidates: Array<[string, string | undefined]> = [
    ["From", message.from],
    ["To", message.to],
    ["Cc", message.cc],
    ["Date", message.date],
  ];
  const fields = candidates.filter((field): field is [string, string] => Boolean(field[1]));
  if (fields.length > 0) {
    header.push({
      kind: "list",
      list: {
        marker: "bullet",
        start: 1,
        items: fields.map(([label, value]) => ({
          blocks: [{ kind: "paragraph", content: [text(`${label}:`, BOLD), text(` ${value}`)] }],
        })),
      },
    });
  }
  pushSection(sections, documentToMarkdown({ blocks: header, notes: [], assets: [] }, new Map()));

  // Inline images the HTML body references are OCR'd in place and not repeated as attachments.
  const usedInline = new Set<number>();
  if (message.html) {
    const byContentId = new Map<string, number>();
    message.attachments.forEach((attachment, index) => {
      if (attachment.contentId) {
        byContentId.set(attachment.contentId, index);
      }
    });
    const body = await renderHtml(message.html, deps, signal, (src) => {
      if (!src.toLowerCase().startsWith("cid:")) {
        return null;
      }
      const index = byContentId.get(normalizeContentId(safeDecode(src.slice(4))) ?? "");
      const attachment = index === undefined ? undefined : message.attachments[index];
      if (index === undefined || !attachment) {
        return null;
      }
      usedInline.add(index);
      return { data: attachment.content, mediaType: attachment.mimeType };
    });
    pushSection(sections, body.markdown);
    warnings.push(...body.warnings);
    ocr ||= body.ocr;
  } else if (message.text) {
    pushSection(sections, normalizeText(message.text));
  }

  const attachments = message.attachments
    .map((attachment, index) => ({ attachment, index }))
    .filter(({ attachment, index }) => !usedInline.has(index) && !SIGNATURE_TYPES.has(attachment.mimeType.toLowerCase()));
  if (attachments.length > 0) {
    sections.push("## Attachments");
  }
  for (const { attachment, index } of attachments) {
    signal?.throwIfAborted();
    const name = attachmentName(attachment, index);
    pushSection(sections, documentToMarkdown({ blocks: [{ kind: "heading", level: 3, content: [text(name)] }], notes: [], assets: [] }, new Map()));
    if (!nested) {
      warnings.push({ code: WarningCode.resourceLimit, message: `attachment "${name}": nested too deeply, not converted` });
      continue;
    }
    const parts: string[] = [];
    for await (const part of nested(attachment.content, name)) {
      if (part.markdown.trim()) {
        parts.push(part.markdown);
        ocr ||= part.source === "ocr" || part.source === "mixed";
      }
      for (const warning of part.warnings) {
        warnings.push({ code: warning.code, message: `attachment "${name}": ${warning.message}` });
      }
    }
    pushSection(sections, parts.join("\n\n"));
  }
  return { markdown: sections.join("\n\n"), warnings, ocr };
}

function pushSection(sections: string[], markdown: string): void {
  const trimmed = markdown.trim();
  if (trimmed) {
    sections.push(trimmed);
  }
}

function text(value: string, style: AnydocStyle = PLAIN): AnydocInline {
  return { kind: "text", text: value.replace(/\s+/g, " "), style };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
