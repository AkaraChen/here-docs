import { detectImageFormat, isDirectRaster } from "./detect.js";
import type { ImageFormat, ImageNormalizerPort } from "./types.js";

export function needsTranscode(format: ImageFormat): boolean {
  return !isDirectRaster(format);
}

export async function toRasterBytes(
  bytes: Uint8Array,
  format: ImageFormat,
  images: ImageNormalizerPort,
  page?: number,
): Promise<Uint8Array> {
  const direct = !needsTranscode(format) || detectImageFormat(bytes) === "jpeg" || detectImageFormat(bytes) === "png";
  if (page === undefined && direct && !pngHasAlpha(bytes)) {
    return bytes;
  }
  return page === undefined ? images.toPng(bytes) : images.toPng(bytes, page);
}

/** A PNG with an alpha channel (color type 4 or 6) or a transparency chunk needs flattening before OCR. */
export function pngHasAlpha(bytes: Uint8Array): boolean {
  if (detectImageFormat(bytes) !== "png" || bytes.length < 33) {
    return false;
  }
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) {
    return true;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    if (type === "tRNS") {
      return true;
    }
    if (type === "IDAT" || type === "IEND") {
      return false;
    }
    offset += 12 + length;
  }
  return false;
}

export function assetLooksRaster(mediaType: string, bytes: Uint8Array): ImageFormat | null {
  const fromMagic = detectImageFormat(bytes);
  if (fromMagic) {
    return fromMagic;
  }
  const mime = mediaType.toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpeg";
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("tiff") || mime.includes("tif")) return "tiff";
  if (mime.includes("heic") || mime.includes("heif")) return "heic";
  if (mime.includes("avif")) return "avif";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("bmp")) return "bmp";
  return null;
}
