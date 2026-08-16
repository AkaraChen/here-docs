import { createDefaultDeps } from "./adapters.js";
import { detectKind } from "./detect.js";
import { assertBytes, WarningCode } from "./errors.js";
import { convertImage } from "./strategies/image.js";
import { convertOffice } from "./strategies/office.js";
import { convertPdf } from "./strategies/pdf.js";
import type { ConvertDeps, ConvertOptions, ConvertResult } from "./types.js";

export async function convert(
  input: Uint8Array,
  options?: ConvertOptions,
  deps?: ConvertDeps,
): Promise<ConvertResult> {
  assertBytes(input);
  const resolved = deps ?? (await createDefaultDeps());
  const ownsDeps = deps === undefined;
  try {
    const detected = detectKind(input, options?.filename, resolved.anydoc);
    switch (detected.kind) {
      case "image":
        return convertImage(input, detected.format, resolved);
      case "pdf":
        return convertPdf(input, resolved);
      case "office":
        return convertOffice(input, detected.format, resolved);
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
  } finally {
    if (ownsDeps) {
      await resolved.ocr.close();
    }
  }
}
