/** An e-mail normalized from EML or MSG, ready to render. */
export interface ParsedMessage {
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  html?: string;
  text?: string;
  attachments: MessageAttachment[];
}

export interface MessageAttachment {
  filename: string | null;
  mimeType: string;
  content: Uint8Array;
  /** Content-ID without angle brackets, when the part has one. */
  contentId?: string;
}

export function normalizeContentId(value: string | undefined | null): string | undefined {
  const id = (value ?? "").trim().replace(/^</, "").replace(/>$/, "").trim();
  return id ? id.toLowerCase() : undefined;
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "message/rfc822": "eml",
  "application/vnd.ms-outlook": "msg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/html": "html",
  "text/csv": "csv",
  "text/calendar": "ics",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/svg+xml": "svg",
};

/** A display name for an attachment; nameless parts get one whose extension comes from the MIME type. */
export function attachmentName(attachment: MessageAttachment, index: number): string {
  const name = attachment.filename?.trim();
  if (name) {
    return name;
  }
  const ext = EXTENSION_BY_TYPE[attachment.mimeType.toLowerCase()];
  return ext ? `attachment-${index + 1}.${ext}` : `attachment-${index + 1}`;
}
