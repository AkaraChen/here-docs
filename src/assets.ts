import { WarningCode } from "./errors.js";
import { linesToMarkdown } from "./markdown/from-ocr.js";
import { assetLooksRaster, toRasterBytes } from "./normalize-image.js";
import { recognizeWithRetry } from "./ocr.js";
import { svgItems } from "./svg.js";
import type { AnydocAsset, ConvertDeps, ImageFormat, Warning } from "./types.js";

export interface AssetOcr {
  ocrByAssetId: Map<number, string>;
  warnings: Warning[];
}

/** OCRs every raster (or renderable) asset of a document model. Failures become warnings. */
export async function recognizeAssets(
  assets: readonly AnydocAsset[],
  deps: ConvertDeps,
  signal: AbortSignal | undefined,
): Promise<AssetOcr> {
  const warnings: Warning[] = [];
  const ocrByAssetId = new Map<number, string>();
  for (const asset of assets) {
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
      const text = (await imageText(asset.data, rasterKind, deps, signal)).trim();
      if (text.length > 0) {
        ocrByAssetId.set(asset.id, text);
      }
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push({
        code: WarningCode.ocrFailed,
        message: `asset ${asset.id}${asset.originPart ? ` (${asset.originPart.slice(0, 80)})` : ""}: ${
          error instanceof Error ? error.message : "OCR failed"
        }`,
      });
    }
  }
  return { ocrByAssetId, warnings };
}

/**
 * The text of one image, one line per line. SVG text is read from the drawing (with embedded rasters OCR'd
 * in place); a drawing without text, and every other format, is rasterized and OCR'd.
 */
export async function imageText(
  bytes: Uint8Array,
  format: ImageFormat,
  deps: ConvertDeps,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (format === "svg") {
    let items: ReturnType<typeof svgItems> = [];
    try {
      items = svgItems(bytes);
    } catch {
      // Unreadable markup: the renderer gets a chance below.
    }
    if (items.length > 0) {
      const lines: string[] = [];
      for (const item of items) {
        if (item.kind === "text") {
          lines.push(item.text);
          continue;
        }
        const kind = assetLooksRaster(item.mediaType, item.data);
        if (kind && kind !== "svg") {
          lines.push(linesToMarkdown(await recognizeWithRetry(deps.ocr, await toRasterBytes(item.data, kind, deps.images), signal, deps.images)).trim());
        }
      }
      return lines.filter(Boolean).join("\n");
    }
  }
  const raster = await toRasterBytes(bytes, format, deps.images);
  return linesToMarkdown(await recognizeWithRetry(deps.ocr, raster, signal, deps.images));
}
