import { detectImageFormat, isDirectRaster } from "./detect.js";
import type { ImageFormat, ImageNormalizerPort } from "./types.js";

export function needsTranscode(format: ImageFormat): boolean {
  return !isDirectRaster(format);
}

export async function toRasterBytes(
  bytes: Uint8Array,
  format: ImageFormat,
  images: ImageNormalizerPort,
): Promise<Uint8Array> {
  if (!needsTranscode(format) || detectImageFormat(bytes) === "jpeg" || detectImageFormat(bytes) === "png") {
    return bytes;
  }
  return images.toPng(bytes);
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
  return null;
}
