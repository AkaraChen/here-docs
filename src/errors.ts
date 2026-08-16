export const WarningCode = {
  unknownType: "unknown-type",
  unsupported: "unsupported",
  encrypted: "encrypted",
  malformed: "malformed",
  missingPart: "missing-part",
  resourceLimit: "resource-limit",
  io: "io",
  ocrFailed: "ocr-failed",
  transcodeFailed: "transcode-failed",
  skippedAsset: "skipped-asset",
  pdfPageOcrFailed: "pdf-page-ocr-failed",
} as const;

export class IllegalConvertInputError extends TypeError {
  constructor(message = "convert() requires Uint8Array bytes") {
    super(message);
    this.name = "IllegalConvertInputError";
  }
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function assertBytes(input: unknown): asserts input is Uint8Array {
  if (!isUint8Array(input)) {
    throw new IllegalConvertInputError();
  }
}

export function anydocErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

export function ocrErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}
