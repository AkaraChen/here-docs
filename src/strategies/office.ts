import { recognizeAssets } from "../assets.js";
import { detectImageFormat } from "../detect.js";
import { anydocErrorCode, WarningCode } from "../errors.js";
import { documentToMarkdown } from "../markdown/from-document.js";
import { toUtf8 } from "../text/decode.js";
import type { AnydocBlock, AnydocDocument, AnydocInline, ConvertDeps, ConvertPart } from "../types.js";
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
    // anydoc reads CSV as UTF-8; legacy encodings (GBK, Shift_JIS, ...) are decoded first.
    document = await deps.anydoc.toDocument(format === "csv" ? toUtf8(bytes) : bytes, format);
  } catch (error) {
    signal?.throwIfAborted();
    yield* recoverOfficeError(bytes, format, deps, error, signal);
    return;
  }

  // Only images the document places are OCR'd: their text goes where they stand.
  const placed = placedAssetIds(document);
  const text = documentToMarkdown(document, new Map());
  if (text.trim() === "" && placed.size === 0 && document.assets.length > 0) {
    // Nothing but unplaced pictures (an image-only slide deck): their OCR text is the manuscript, as for a scan.
    const { ocrByAssetId, warnings } = await recognizeAssets(document.assets, deps, signal);
    yield wholePart([...ocrByAssetId.values()].join("\n\n"), warnings);
    return;
  }
  const { ocrByAssetId, warnings } = await recognizeAssets(document.assets.filter((asset) => placed.has(asset.id)), deps, signal);
  yield wholePart(documentToMarkdown(document, ocrByAssetId), warnings);
}

function placedAssetIds(document: AnydocDocument): Set<number> {
  const ids = new Set<number>();
  const visitInlines = (inlines: readonly AnydocInline[] | undefined) => {
    for (const inline of inlines ?? []) {
      if (inline.kind === "image" && inline.source?.kind === "asset" && inline.source.assetId !== undefined) {
        ids.add(inline.source.assetId);
      }
      visitInlines(inline.content);
    }
  };
  const visitBlocks = (blocks: readonly AnydocBlock[] | undefined) => {
    for (const block of blocks ?? []) {
      visitInlines(block.content);
      visitBlocks(block.blocks);
      for (const item of block.list?.items ?? []) visitBlocks(item.blocks);
      for (const row of block.table?.grid ?? []) for (const slot of row) visitBlocks(slot.cell?.blocks);
    }
  };
  visitBlocks(document.blocks);
  for (const note of document.notes) visitBlocks(note.blocks);
  return ids;
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
