import { detectKind } from "./detect.js";
import { assertBytes, IllegalConvertInputError, WarningCode } from "./errors.js";
import { htmlParts } from "./strategies/html.js";
import { imageParts } from "./strategies/image.js";
import { messageParts } from "./strategies/message.js";
import { notebookParts } from "./strategies/notebook.js";
import { ofdParts } from "./strategies/ofd.js";
import { officeParts } from "./strategies/office.js";
import { wholePart } from "./strategies/part.js";
import { pdfParts } from "./strategies/pdf.js";
import { textParts } from "./strategies/text.js";
import type { ConvertEngine, ConvertOptions, ConvertPart, ConvertResult, NestedConvert, Warning } from "./types.js";

/** Attachments nested deeper than this (a message attached to a message ...) are listed, not converted. */
export const MAX_ATTACHMENT_DEPTH = 3;

/**
 * Converts `input` part by part. Paged inputs (PDF, OFD, multi-page TIFF) yield one part per page in page
 * order, and each page is extracted or OCR'd only when it is requested, so breaking out of the loop skips
 * the remaining pages. Other inputs yield exactly one part with `page: null`.
 *
 * Illegal arguments throw here, before iteration starts. An aborted `options.signal` rejects the
 * pending (or next) step with `signal.reason`.
 */
export function convertPages(input: Uint8Array, options: ConvertOptions): AsyncGenerator<ConvertPart> {
  assertBytes(input);
  const engine = requireEngine(options);
  return clean(parts(input, options.filename, engine, options.signal, 0));
}

/** Control characters (NUL padding in Outlook fields, stray form feeds) never reach the manuscript. */
async function* clean(source: AsyncGenerator<ConvertPart>): AsyncGenerator<ConvertPart> {
  for await (const part of source) {
    yield { ...part, markdown: part.markdown.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "") };
  }
}

export async function convert(input: Uint8Array, options: ConvertOptions): Promise<ConvertResult> {
  const sections: string[] = [];
  const warnings: Warning[] = [];
  for await (const part of convertPages(input, options)) {
    if (part.markdown.trim()) {
      sections.push(part.markdown);
    }
    warnings.push(...part.warnings);
  }
  return { markdown: sections.length > 0 ? `${sections.join("\n\n")}\n` : "", warnings };
}

async function* parts(
  input: Uint8Array,
  filename: string | undefined,
  engine: ConvertEngine,
  signal: AbortSignal | undefined,
  depth: number,
): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  const detected = detectKind(input, filename, engine.anydoc);
  switch (detected.kind) {
    case "image":
      yield* imageParts(input, detected.format, engine, signal);
      return;
    case "pdf":
      yield* pdfParts(input, engine, signal);
      return;
    case "office":
      yield* officeParts(input, detected.format, engine, signal);
      return;
    case "text":
      yield* textParts(input, signal);
      return;
    case "html":
      yield* htmlParts(input, engine, signal);
      return;
    case "message": {
      const nested: NestedConvert | null =
        depth < MAX_ATTACHMENT_DEPTH ? (bytes, name) => parts(bytes, name, engine, signal, depth + 1) : null;
      yield* messageParts(input, detected.format, engine, signal, nested);
      return;
    }
    case "ofd":
      yield* ofdParts(input, engine, signal);
      return;
    case "notebook":
      yield* notebookParts(input, engine, signal);
      return;
    default:
      yield wholePart("", [{ code: WarningCode.unknownType, message: "unrecognized file type" }], "none");
  }
}

function requireEngine(options: ConvertOptions | undefined): ConvertEngine {
  if (!options?.engine) {
    throw new IllegalConvertInputError("convert() requires an engine from createEngine()");
  }
  return options.engine;
}
