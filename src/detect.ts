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
};

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
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heif", "mif1", "msf1", "hevc", "hevx", "heim", "heis"].includes(brand)) {
      return "heic";
    }
  }
  return null;
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === "%PDF";
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
  const normalized = name.toLowerCase();
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

  const ext = extensionOf(filename);
  if (ext) {
    if (ext === "pdf") {
      return { kind: "pdf" };
    }
    const imageExt = IMAGE_EXTENSIONS[ext];
    if (imageExt) {
      return { kind: "image", format: imageExt };
    }
    const hinted = anydoc.formatFromExtension(ext) ?? officeFormat(ext);
    if (hinted && hinted !== "pdf") {
      return { kind: "office", format: officeFormat(hinted) ?? hinted };
    }
  }

  return { kind: "unknown" };
}

export function isDirectRaster(format: ImageFormat): boolean {
  return format === "jpeg" || format === "png";
}
