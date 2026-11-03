import { decompressRTF } from "@kenjiuno/decompressrtf";
import * as msgreaderModule from "@kenjiuno/msgreader";
import type { FieldsData } from "@kenjiuno/msgreader";
import iconv from "iconv-lite";
import { deEncapsulateSync } from "rtf-stream-parser";
import { decodeTextLoose } from "../text/decode.js";
import { normalizeContentId, type MessageAttachment, type ParsedMessage } from "./model.js";

type MsgReaderClass = new (buffer: ArrayBuffer) => {
  parserConfig?: { ansiEncoding?: string };
  getFileData(): FieldsData;
  getAttachment(attach: FieldsData): { fileName: string; content: Uint8Array };
};

/** The CommonJS default export arrives as `default` or `default.default` depending on the runtime's interop. */
const exported = msgreaderModule.default as unknown as MsgReaderClass | { default: MsgReaderClass };
const MsgReader: MsgReaderClass = typeof exported === "function" ? exported : exported.default;

export function parseMsg(bytes: Uint8Array): { message: ParsedMessage; warnings: string[] } {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let reader = new MsgReader(buffer);
  let data = reader.getFileData();
  // Non-Unicode string properties are in the sender's Windows code page, which the reader cannot know.
  const ansi = ansiEncoding(data);
  if (ansi) {
    reader = new MsgReader(buffer);
    reader.parserConfig = { ansiEncoding: ansi };
    data = reader.getFileData();
  }
  if (data.error) {
    throw new Error(data.error);
  }
  const warnings: string[] = [];
  const attachments: MessageAttachment[] = [];
  for (const field of data.attachments ?? []) {
    try {
      const attachment = reader.getAttachment(field);
      attachments.push({
        filename: attachment.fileName || field.name || null,
        mimeType: field.innerMsgContent ? "application/vnd.ms-outlook" : (field.attachMimeTag ?? "application/octet-stream"),
        content: attachment.content,
        contentId: normalizeContentId(field.pidContentId),
      });
    } catch (error) {
      warnings.push(`attachment "${field.fileName ?? field.name ?? "unnamed"}": ${error instanceof Error ? error.message : "unreadable"}`);
    }
  }
  return {
    message: {
      subject: data.subject?.trim() || undefined,
      from: formatPerson(data.senderName, data.senderSmtpAddress ?? data.senderEmail),
      to: recipients(data, "to"),
      cc: recipients(data, "cc"),
      date: data.messageDeliveryTime ?? data.clientSubmitTime ?? data.creationTime,
      html: htmlBody(data),
      text: data.body || undefined,
      attachments,
    },
    warnings,
  };
}

function htmlBody(data: FieldsData): string | undefined {
  if (data.bodyHtml) {
    return data.bodyHtml;
  }
  if (data.html && data.html.length > 0) {
    return decodeTextLoose(data.html, data.internetCodepage ? `cp${data.internetCodepage}` : undefined);
  }
  if (!data.compressedRtf) {
    return undefined;
  }
  // Outlook stores HTML mail as RTF that encapsulates the original HTML (\fromhtml1).
  try {
    const rtf = Buffer.from(decompressRTF(Array.from(data.compressedRtf)));
    const result = deEncapsulateSync(rtf, { mode: "html", decode: (buffer: Buffer, encoding: string) => iconv.decode(buffer, encoding) });
    return typeof result.text === "string" ? result.text : result.text.toString("utf8");
  } catch {
    // Plain RTF (not encapsulated HTML): the plain-text body is used instead.
    return undefined;
  }
}

/** Internet code pages that imply a different Windows (ANSI) code page for the same language. */
const ANSI_FOR_INTERNET: Record<number, number> = {
  50220: 932,
  50221: 932,
  50222: 932,
  51932: 932,
  20932: 932,
  54936: 936,
  20936: 936,
  52936: 936,
  51949: 949,
  50225: 949,
  20866: 1251,
  21866: 1251,
  28595: 1251,
  28592: 1250,
  28597: 1253,
};

/** The code page of PT_STRING8 properties: the message code page, else the one its internet code page implies. */
function ansiEncoding(data: FieldsData): string | undefined {
  const internet = data.internetCodepage;
  const codepage = data.messageCodepage ?? (internet === undefined ? undefined : (ANSI_FOR_INTERNET[internet] ?? internet));
  if (codepage === undefined || codepage === 1252 || codepage === 20127 || codepage === 28591 || codepage === 65001 || codepage === 1200) {
    return undefined;
  }
  const label = codepage >= 1250 && codepage <= 1258 ? `windows-${codepage}` : `cp${codepage}`;
  return iconv.encodingExists(label) ? label : undefined;
}

function recipients(data: FieldsData, type: "to" | "cc"): string | undefined {
  const list = (data.recipients ?? [])
    .filter((recipient) => (recipient.recipType ?? "to") === type)
    .map((recipient) => formatPerson(recipient.name, recipient.smtpAddress ?? recipient.email))
    .filter((value): value is string => value !== undefined);
  const unique = [...new Set(list)];
  return unique.length > 0 ? unique.join(", ") : undefined;
}

function formatPerson(name: string | undefined, address: string | undefined): string | undefined {
  const display = name?.trim();
  const mail = address?.trim();
  if (display && mail && display !== mail) {
    return `${display} <${mail}>`;
  }
  return display || mail || undefined;
}
