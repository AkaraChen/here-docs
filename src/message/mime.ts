/**
 * A minimal MIME reader for web archives (MHTML). Archived pages reference their images by
 * `Content-Location`, which e-mail parsers do not expose, so this reader keeps every part's headers.
 */
export interface MimePart {
  headers: Map<string, string>;
  /** Lowercase `type/subtype`. */
  contentType: string;
  /** Lowercase parameter names, unquoted values. */
  params: Record<string, string>;
  /** Body with the transfer encoding removed. Empty for multipart containers. */
  body: Uint8Array;
  children: MimePart[];
}

const MAX_DEPTH = 32;

export function parseMime(bytes: Uint8Array, depth = 0): MimePart {
  const raw = latin1(bytes);
  const split = /\r?\n\r?\n/.exec(raw);
  const headerText = split ? raw.slice(0, split.index) : raw;
  const bodyStart = split ? split.index + split[0].length : raw.length;
  const headers = parseHeaders(headerText);
  const [contentType, params] = parseContentType(headers.get("content-type") ?? "text/plain");
  const bodyRaw = raw.slice(bodyStart);
  if (contentType.startsWith("multipart/") && params.boundary && depth < MAX_DEPTH) {
    const children = splitMultipart(bodyRaw, params.boundary).map((part) => parseMime(fromLatin1(part), depth + 1));
    return { headers, contentType, params, body: new Uint8Array(0), children };
  }
  return { headers, contentType, params, body: decodeTransfer(bodyRaw, headers.get("content-transfer-encoding")), children: [] };
}

/** Leaf parts in document order. */
export function leafParts(part: MimePart): MimePart[] {
  return part.children.length === 0 ? [part] : part.children.flatMap(leafParts);
}

export function parseHeaders(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) {
      headers.set(name, line.slice(colon + 1).trim());
    }
  }
  return headers;
}

export function parseContentType(value: string): [string, Record<string, string>] {
  const [type = "", ...rest] = splitParams(value);
  const params: Record<string, string> = {};
  for (const param of rest) {
    const eq = param.indexOf("=");
    if (eq > 0) {
      params[param.slice(0, eq).trim().toLowerCase()] = param.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    }
  }
  return [type.trim().toLowerCase(), params];
}

/** Splits on `;` outside double quotes. */
function splitParams(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === '"') {
      quoted = !quoted;
    }
    if (char === ";" && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const afterDelimiter = index + delimiter.length;
    if (body.startsWith("--", afterDelimiter)) {
      break;
    }
    const lineEnd = body.indexOf("\n", afterDelimiter);
    if (lineEnd === -1) {
      break;
    }
    const next = body.indexOf(`\n${delimiter}`, lineEnd);
    const end = next === -1 ? body.length : next;
    parts.push(body.slice(lineEnd + 1, end).replace(/\r$/, ""));
    index = next === -1 ? -1 : next + 1;
  }
  return parts;
}

function decodeTransfer(body: string, encoding: string | undefined): Uint8Array {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "base64":
      return new Uint8Array(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64"));
    case "quoted-printable":
      return fromLatin1(
        body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
      );
    default:
      return fromLatin1(body);
  }
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

function fromLatin1(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "latin1"));
}
