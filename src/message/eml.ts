import PostalMime from "postal-mime";
import type { Address } from "postal-mime";
import { decodeText } from "../text/decode.js";
import { normalizeContentId, type ParsedMessage } from "./model.js";

export async function parseEml(bytes: Uint8Array): Promise<ParsedMessage> {
  // Attached and forwarded messages stay attachments, so they are rendered by this library like any other file.
  const email = await PostalMime.parse(refold(bytes), { forceRfc822Attachments: true, attachmentEncoding: "arraybuffer" });
  const charset = declaredCharset(bytes);
  const fix = (value: string | undefined) => (value === undefined ? undefined : raw8bit(value, charset));
  return {
    subject: fix(email.subject)?.trim() || undefined,
    from: fix(formatAddresses(email.from ? [email.from] : undefined)),
    to: fix(formatAddresses(email.to)),
    cc: fix(formatAddresses(email.cc)),
    date: email.date || undefined,
    html: iso2022(email.html) || undefined,
    text: iso2022(email.text) || undefined,
    attachments: email.attachments.map((attachment) => ({
      filename: attachment.filename === null ? null : raw8bit(attachment.filename, charset),
      mimeType: attachment.mimeType,
      content:
        typeof attachment.content === "string"
          ? new TextEncoder().encode(attachment.content)
          : new Uint8Array(attachment.content),
      contentId: normalizeContentId(attachment.contentId),
    })),
  };
}

/**
 * Mailers that skip RFC 2047 put raw 8-bit bytes in headers (Korean, Russian, and Chinese mail especially);
 * the parser reads them as Latin-1. Such text is re-decoded: UTF-8 if it is, else the message's declared
 * charset, else a detected one. Text with characters beyond Latin-1 was decoded properly and is kept.
 */
function raw8bit(value: string, charset: string | undefined): string {
  if (!/[\u0080-\u00ff]/.test(value) || /[^\u0000-\u00ff]/.test(value)) {
    return value;
  }
  return decodeText(Buffer.from(value, "latin1"), charset)?.text ?? value;
}

/** A body without a charset is read as ASCII; ISO-2022-JP hides its kanji behind escape sequences there. */
function iso2022(value: string | undefined): string | undefined {
  if (!value || !/\u001b\$[@B]/.test(value) || /[^\u0000-\u007f]/.test(value)) {
    return value;
  }
  return decodeText(Buffer.from(value, "latin1"))?.text ?? value;
}

/**
 * Some mailers fold long encoded headers without the leading whitespace RFC 5322 requires, which ends the
 * header block early and pushes the remaining headers into the body. Such lines are re-indented.
 */
function refold(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const end = text.search(/\r?\n\r?\n/);
  const header = end === -1 ? text : text.slice(0, end);
  const lines = header.split(/(?<=\n)/);
  let changed = false;
  const fixed = lines.map((line, index) => {
    if (index > 0 && /^=\?[^?\s]+\?[bqBQ]\?/.test(line)) {
      changed = true;
      return ` ${line}`;
    }
    return line;
  });
  return changed ? Buffer.from(fixed.join("") + text.slice(header.length), "latin1") : bytes;
}

/** The first charset a part declares, a hint for headers that declare none. */
function declaredCharset(bytes: Uint8Array): string | undefined {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 256 * 1024)).toString("latin1");
  const match = /charset\s*=\s*"?([\w.:-]+)/i.exec(head);
  const charset = match?.[1]?.toLowerCase();
  return charset && charset !== "us-ascii" && charset !== "utf-8" ? charset : undefined;
}

function formatAddresses(addresses: Address[] | undefined): string | undefined {
  const formatted = (addresses ?? []).map(formatAddress).filter((value) => value.length > 0);
  return formatted.length > 0 ? formatted.join(", ") : undefined;
}

function formatAddress(address: Address): string {
  if (address.group) {
    return `${address.name}: ${address.group.map(formatAddress).join(", ")};`;
  }
  const name = address.name.trim();
  const mail = address.address.trim();
  if (name && mail && name !== mail) {
    return `${name} <${mail}>`;
  }
  return name || mail;
}
