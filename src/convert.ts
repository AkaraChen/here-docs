import { detectKind } from "./detect.js";
import { assertBytes, IllegalConvertInputError, WarningCode } from "./errors.js";
import { imageParts } from "./strategies/image.js";
import { officeParts } from "./strategies/office.js";
import { wholePart } from "./strategies/part.js";
import { pdfParts } from "./strategies/pdf.js";
import type { ConvertEngine, ConvertOptions, ConvertPart, ConvertResult, Warning } from "./types.js";

/**
 * Converts `input` part by part. PDFs yield one part per page in page order, and each page is extracted
 * or OCR'd only when it is requested, so breaking out of the loop skips the remaining pages. Other inputs
 * yield exactly one part with `page: null`.
 *
 * Illegal arguments throw here, before iteration starts. An aborted `options.signal` rejects the
 * pending (or next) step with `signal.reason`.
 */
export function convertPages(input: Uint8Array, options: ConvertOptions): AsyncGenerator<ConvertPart> {
  assertBytes(input);
  const engine = requireEngine(options);
  return parts(input, options.filename, engine, options.signal);
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
    default:
      yield wholePart("", [{ code: WarningCode.unknownType, message: "unrecognized file type" }]);
  }
}

function requireEngine(options: ConvertOptions | undefined): ConvertEngine {
  if (!options?.engine) {
    throw new IllegalConvertInputError("convert() requires an engine from createEngine()");
  }
  return options.engine;
}
