import { detectImageFormat } from "../detect.js";
import { anydocErrorCode, WarningCode } from "../errors.js";
import { documentToMarkdown } from "../markdown/from-document.js";
import { linesToMarkdown } from "../markdown/from-ocr.js";
import { assetLooksRaster, toRasterBytes } from "../normalize-image.js";
import { recognizeWithRetry } from "../ocr.js";
import type { AnydocDocument, ConvertDeps, ConvertPart, Warning } from "../types.js";
import { imageParts } from "./image.js";
import { wholePart } from "./part.js";
import { pdfParts } from "./pdf.js";

export async function* officeParts(
  bytes: Uint8Array,
  format: string,
  deps: ConvertDeps,
  signal?: AbortSignal,
): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  let document: AnydocDocument;
  try {
    document = await deps.anydoc.toDocument(bytes, format);
  } catch (error) {
    signal?.throwIfAborted();
    yield* recoverOfficeError(bytes, format, deps, error, signal);
    return;
  }

  const warnings: Warning[] = [];
  const ocrByAssetId = new Map<number, string>();
  for (const asset of document.assets) {
    signal?.throwIfAborted();
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
      const lines = await recognizeWithRetry(deps.ocr, raster, signal);
      const text = linesToMarkdown(lines).trim();
      if (text.length > 0) {
        ocrByAssetId.set(asset.id, text);
      }
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push({
        code: WarningCode.ocrFailed,
        message:
          error instanceof Error
            ? `asset ${asset.id}: ${error.message}`
            : `asset ${asset.id}: OCR failed`,
      });
    }
  }

  yield wholePart(documentToMarkdown(document, ocrByAssetId), warnings);
}

async function* recoverOfficeError(
  bytes: Uint8Array,
  format: string,
  deps: ConvertDeps,
  error: unknown,
  signal: AbortSignal | undefined,
): AsyncGenerator<ConvertPart> {
  const code = anydocErrorCode(error);
  if (code === "unsupported") {
    const image = detectImageFormat(bytes);
    if (image) {
      yield* imageParts(bytes, image, deps, signal);
      return;
    }
    if (format === "pdf" || looksLikePdf(bytes)) {
      yield* pdfParts(bytes, deps, signal);
      return;
    }
    yield warningResult(WarningCode.unsupported, messageOf(error, "unsupported document"));
    return;
  }
  if (code === "encrypted") {
    yield warningResult(WarningCode.encrypted, messageOf(error, "encrypted document"));
    return;
  }
  if (code === "malformed") {
    yield warningResult(WarningCode.malformed, messageOf(error, "malformed document"));
    return;
  }
  if (code === "missingPart") {
    yield warningResult(WarningCode.missingPart, messageOf(error, "document is missing a required part"));
    return;
  }
  if (code === "resourceLimit") {
    yield warningResult(WarningCode.resourceLimit, messageOf(error, "document exceeded a resource limit"));
    return;
  }
  if (code === "io") {
    yield warningResult(WarningCode.io, messageOf(error, "document could not be read"));
    return;
  }
  yield warningResult(WarningCode.unsupported, messageOf(error, "document conversion failed"));
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "%PDF";
}

function warningResult(code: string, message: string): ConvertPart {
  return wholePart("", [{ code, message }]);
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
