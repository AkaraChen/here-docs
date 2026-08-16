import { anydocErrorCode, WarningCode } from "../errors.js";
import { documentToMarkdown } from "../markdown/from-document.js";
import { linesToMarkdown } from "../markdown/from-ocr.js";
import { assetLooksRaster, toRasterBytes } from "../normalize-image.js";
import { recognizeWithRetry } from "../ocr.js";
import type { ConvertDeps, ConvertResult, Warning } from "../types.js";
import { convertImage } from "./image.js";
import { convertPdf } from "./pdf.js";

export async function convertOffice(
  bytes: Uint8Array,
  format: string,
  deps: ConvertDeps,
): Promise<ConvertResult> {
  try {
    const document = await deps.anydoc.toDocument(bytes, format);
    const warnings: Warning[] = [];
    const ocrByAssetId = new Map<number, string>();

    for (const asset of document.assets) {
      const rasterKind = assetLooksRaster(asset.mediaType, asset.data);
      if (!rasterKind) {
        warnings.push({
          code: WarningCode.skippedAsset,
          message: `skipped non-raster asset ${asset.id} (${asset.mediaType || "unknown"})`,
        });
        continue;
      }
      try {
        const raster = await toRasterBytes(asset.data, rasterKind, deps.images);
        const lines = await recognizeWithRetry(deps.ocr, raster);
        const text = linesToMarkdown(lines).trim();
        if (text.length > 0) {
          ocrByAssetId.set(asset.id, text);
        }
      } catch (error) {
        warnings.push({
          code: WarningCode.ocrFailed,
          message:
            error instanceof Error
              ? `asset ${asset.id}: ${error.message}`
              : `asset ${asset.id}: OCR failed`,
        });
      }
    }

    return {
      markdown: documentToMarkdown(document, ocrByAssetId),
      warnings,
    };
  } catch (error) {
    return recoverOfficeError(bytes, format, deps, error);
  }
}

async function recoverOfficeError(
  bytes: Uint8Array,
  format: string,
  deps: ConvertDeps,
  error: unknown,
): Promise<ConvertResult> {
  const code = anydocErrorCode(error);
  if (code === "unsupported") {
    const image = await maybeImage(bytes, deps);
    if (image) {
      return image;
    }
    if (format === "pdf" || looksLikePdf(bytes)) {
      return convertPdf(bytes, deps);
    }
    return warningResult(WarningCode.unsupported, messageOf(error, "unsupported document"));
  }
  if (code === "encrypted") {
    return warningResult(WarningCode.encrypted, messageOf(error, "encrypted document"));
  }
  if (code === "malformed") {
    return warningResult(WarningCode.malformed, messageOf(error, "malformed document"));
  }
  if (code === "missingPart") {
    return warningResult(WarningCode.missingPart, messageOf(error, "document is missing a required part"));
  }
  if (code === "resourceLimit") {
    return warningResult(WarningCode.resourceLimit, messageOf(error, "document exceeded a resource limit"));
  }
  if (code === "io") {
    return warningResult(WarningCode.io, messageOf(error, "document could not be read"));
  }
  return warningResult(WarningCode.unsupported, messageOf(error, "document conversion failed"));
}

async function maybeImage(bytes: Uint8Array, deps: ConvertDeps): Promise<ConvertResult | null> {
  const { detectImageFormat } = await import("../detect.js");
  const format = detectImageFormat(bytes);
  if (!format) {
    return null;
  }
  return convertImage(bytes, format, deps);
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "%PDF";
}

function warningResult(code: string, message: string): ConvertResult {
  return { markdown: "", warnings: [{ code, message }] };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
