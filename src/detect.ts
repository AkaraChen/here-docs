import { unzipSync } from "fflate";
import { isBmp } from "./bmp.js";
import { sniffText } from "./text/decode.js";
import { isZipBytes, zipPayload } from "./zip.js";
import type { AnydocPort, DetectedKind, ImageFormat } from "./types.js";

const OFFICE_FORMATS = new Set([
  "doc",
  "docx",
  "docm",
  "odt",
  "ppt",
  "pptx",
  "pptm",
  "pps",
  "ppsx",
  "pot",
  "rtf",
  "epub",
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "ods",
  "odp",
  "csv",
]);

/** Extensions anydoc does not name: templates, Kingsoft WPS binaries, and TSV, mapped to the parser that reads them. */
const OFFICE_ALIASES: Record<string, string> = {
  dot: "doc",
  dotx: "docx",
  dotm: "docx",
  xlt: "xlsx",
  xltx: "xlsx",
  xltm: "xlsx",
  potx: "pptx",
  potm: "pptx",
  ott: "odt",
  ots: "ods",
  otp: "odp",
  wps: "doc",
  wpt: "doc",
  et: "xlsx",
  ett: "xlsx",
  dps: "ppt",
  dpt: "ppt",
  tsv: "csv",
  tab: "csv",
};

const IMAGE_EXTENSIONS: Record<string, ImageFormat> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  tif: "tiff",
  tiff: "tiff",
  heic: "heic",
  heif: "heic",
  avif: "avif",
  svg: "svg",
  svgz: "svg",
  bmp: "bmp",
  dib: "bmp",
};

const TEXT_EXTENSIONS: Record<string, DetectedKind> = {
  txt: { kind: "text", format: "plain" },
  text: { kind: "text", format: "plain" },
  md: { kind: "text", format: "markdown" },
  markdown: { kind: "text", format: "markdown" },
  mdown: { kind: "text", format: "markdown" },
  mkd: { kind: "text", format: "markdown" },
  mkdn: { kind: "text", format: "markdown" },
  html: { kind: "html" },
  htm: { kind: "html" },
  xhtml: { kind: "html" },
  xht: { kind: "html" },
  eml: { kind: "message", format: "eml" },
  mht: { kind: "message", format: "mhtml" },
  mhtml: { kind: "message", format: "mhtml" },
  msg: { kind: "message", format: "msg" },
  ipynb: { kind: "notebook" },
  ofd: { kind: "ofd" },
};

const HEIC_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "heif"];
const AVIF_BRANDS = ["avif", "avis"];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return "gif";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    return "webp";
  }
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "tiff";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    return isoBrandFormat(bytes);
  }
  if (isBmp(bytes)) {
    return "bmp";
  }
  return null;
}

/** HEIF-family files name their codec in the major brand, or in a compatible brand when the major is generic (`mif1`). */
function isoBrandFormat(bytes: Uint8Array): ImageFormat | null {
  const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const end = Math.min(bytes.length, Math.max(16, boxSize));
  const brands = [ascii(bytes, 8, 4)];
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(ascii(bytes, offset, 4));
  }
  if (AVIF_BRANDS.includes(brands[0]!)) {
    return "avif";
  }
  if (HEIC_BRANDS.includes(brands[0]!)) {
    return brands.some((brand) => AVIF_BRANDS.includes(brand)) && !brands.some((brand) => brand.startsWith("he"))
      ? "avif"
      : "heic";
  }
  return null;
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === "%PDF";
}

export function isCfbBytes(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

export function extensionOf(filename: string | undefined): string | null {
  if (!filename) {
    return null;
  }
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return null;
  }
  return base.slice(dot + 1).toLowerCase();
}

function officeFormat(name: string): string | null {
  const normalized = OFFICE_ALIASES[name.toLowerCase()] ?? name.toLowerCase();
  if (OFFICE_FORMATS.has(normalized)) {
    if (normalized === "docm") return "docx";
    if (normalized === "pptm" || normalized === "pps" || normalized === "ppsx" || normalized === "pot") {
      return "pptx";
    }
    if (normalized === "xlsm" || normalized === "xlsb" || normalized === "xls") {
      return "xlsx";
    }
    return normalized;
  }
  return null;
}

export function detectKind(
  bytes: Uint8Array,
  filename: string | undefined,
  anydoc: AnydocPort,
): DetectedKind {
  const signed = detectBySignature(bytes, anydoc);
  if (signed) {
    return signed;
  }
  const hinted = detectByExtension(extensionOf(filename), anydoc);
  if (hinted && !hasSignature(hinted)) {
    return hinted;
  }
  // The bytes lack the signature the name promises. Business systems routinely save HTML or delimited text
  // under Office names (`export.xls`), so text content is sniffed; only binary bytes keep the hinted route.
  const sniffed = detectByText(bytes);
  if (!hinted || sniffed.kind !== "text") {
    return sniffed.kind === "unknown" && hinted ? hinted : sniffed;
  }
  return hinted.kind === "office" && SPREADSHEETS.has(hinted.format) ? { kind: "office", format: "csv" } : sniffed;
}

const SPREADSHEETS = new Set(["xlsx", "ods"]);

/** Formats that always carry a binary signature, so a name alone cannot make bytes one of them. */
function hasSignature(kind: DetectedKind): boolean {
  switch (kind.kind) {
    case "pdf":
    case "ofd":
      return true;
    case "image":
      return kind.format !== "svg";
    case "office":
      return kind.format !== "csv";
    case "message":
      return kind.format === "msg";
    default:
      return false;
  }
}

function detectBySignature(bytes: Uint8Array, anydoc: AnydocPort): DetectedKind | null {
  const image = detectImageFormat(bytes);
  if (image) {
    return { kind: "image", format: image };
  }
  if (isPdfBytes(bytes)) {
    return { kind: "pdf" };
  }
  const fromBytes = anydoc.formatFromBytes(bytes);
  if (fromBytes === "pdf") {
    return { kind: "pdf" };
  }
  if (fromBytes && officeFormat(fromBytes)) {
    return { kind: "office", format: officeFormat(fromBytes) ?? fromBytes };
  }
  const zip = zipPayload(bytes);
  if (isZipBytes(zip) && zipHasEntry(zip, "ofd.xml")) {
    return { kind: "ofd" };
  }
  if (isCfbBytes(bytes) && containsUtf16(bytes, "__substg1.0_")) {
    return { kind: "message", format: "msg" };
  }
  return null;
}

function detectByExtension(ext: string | null, anydoc: AnydocPort): DetectedKind | null {
  if (!ext) {
    return null;
  }
  if (ext === "pdf") {
    return { kind: "pdf" };
  }
  const imageExt = IMAGE_EXTENSIONS[ext];
  if (imageExt) {
    return { kind: "image", format: imageExt };
  }
  const textExt = TEXT_EXTENSIONS[ext];
  if (textExt) {
    return textExt;
  }
  const hinted = anydoc.formatFromExtension(ext) ?? officeFormat(ext);
  if (hinted && hinted !== "pdf") {
    return { kind: "office", format: officeFormat(hinted) ?? hinted };
  }
  return null;
}

/** Signature-less formats are recognized from markers in their decoded text; other text is plain text. */
function detectByText(bytes: Uint8Array): DetectedKind {
  const text = sniffText(bytes);
  if (text === null) {
    return { kind: "unknown" };
  }
  const head = text.slice(0, 4096).replace(/^\s+/, "");
  const lower = head.toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype\s+html|<html[\s>])/.test(lower)) {
    return { kind: "html" };
  }
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/.test(lower)) {
    return { kind: "image", format: "svg" };
  }
  const message = mimeKind(head);
  if (message) {
    return { kind: "message", format: message };
  }
  if (head.startsWith("{") && /"nbformat"\s*:/.test(text) && /"(cells|worksheets)"\s*:/.test(text)) {
    return { kind: "notebook" };
  }
  return { kind: "text", format: "plain" };
}

/** A block of RFC 822 header lines: MHTML when it is a `multipart/related` snapshot, e-mail otherwise. */
export function mimeKind(head: string): "eml" | "mhtml" | null {
  const lines = head.split(/\r?\n/);
  const names = new Set<string>();
  let contentType = "";
  for (const line of lines) {
    if (line === "") {
      break;
    }
    if (/^[ \t]/.test(line)) {
      if (names.size === 0) {
        return null;
      }
      continue;
    }
    const match = /^([!-9;-~]+):/.exec(line);
    if (!match) {
      return null;
    }
    const name = match[1]!.toLowerCase();
    names.add(name);
    if (name === "content-type") {
      contentType = line.toLowerCase();
    }
  }
  if (contentType.includes("multipart/related") && (names.has("snapshot-content-location") || !(names.has("to") || names.has("cc")))) {
    return "mhtml";
  }
  const mailHeaders = ["from", "to", "cc", "subject", "date", "received", "message-id", "mime-version", "return-path"];
  const hits = mailHeaders.filter((name) => names.has(name)).length;
  // A bare MIME entity (the clear-signed body inside an S/MIME `smime.p7m`) has only content headers.
  return hits >= 2 || contentType.includes("multipart/") ? "eml" : null;
}

/** Reads only the ZIP central directory; no entry is decompressed. */
export function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter(file) {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    return names;
  }
  return names;
}

function zipHasEntry(bytes: Uint8Array, name: string): boolean {
  return zipEntryNames(bytes).some((entry) => entry.replace(/^\/+/, "").toLowerCase() === name);
}

function containsUtf16(bytes: Uint8Array, text: string): boolean {
  const needle = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    needle[i * 2] = text.charCodeAt(i);
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(needle) !== -1;
}

export function isDirectRaster(format: ImageFormat): boolean {
  return format === "jpeg" || format === "png";
}
