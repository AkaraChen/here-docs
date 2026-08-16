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

export class UnsupportedPlatformError extends Error {
  readonly code = "unsupported-platform";

  constructor(platform: string, reason: string) {
    super(`here-docs cannot start on ${platform}: ${reason}`);
    this.name = "UnsupportedPlatformError";
  }
}

export class MissingPlatformPackageError extends Error {
  readonly code = "missing-platform-package";
  readonly packages: readonly string[];

  constructor(packages: readonly string[], platform: string) {
    super(
      `here-docs is missing native packages for ${platform}: ${packages.join(", ")}. ` +
        "Reinstall without omitting optional dependencies (do not use --omit=optional or optional=false).",
    );
    this.name = "MissingPlatformPackageError";
    this.packages = packages;
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
