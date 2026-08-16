import { detectKind } from "./detect.js";
import { assertBytes, IllegalConvertInputError, WarningCode } from "./errors.js";
import { convertImage } from "./strategies/image.js";
import { convertOffice } from "./strategies/office.js";
import { convertPdf } from "./strategies/pdf.js";
import type { ConvertEngine, ConvertOptions, ConvertResult } from "./types.js";

export async function convert(
  input: Uint8Array,
  options: ConvertOptions,
): Promise<ConvertResult> {
  assertBytes(input);
  const engine = requireEngine(options);
  const detected = detectKind(input, options.filename, engine.anydoc);
  switch (detected.kind) {
    case "image":
      return convertImage(input, detected.format, engine);
    case "pdf":
      return convertPdf(input, engine);
    case "office":
      return convertOffice(input, detected.format, engine);
    default:
      return {
        markdown: "",
        warnings: [
          {
            code: WarningCode.unknownType,
            message: "unrecognized file type",
          },
        ],
      };
  }
}

function requireEngine(options: ConvertOptions | undefined): ConvertEngine {
  if (!options?.engine) {
    throw new IllegalConvertInputError("convert() requires an engine from createEngine()");
  }
  return options.engine;
}
