import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const { assertNativePackages } = await import(pathToFileURL(join(dist, "natives.js")).href);
const { MissingPlatformPackageError, UnsupportedPlatformError } = await import(
  pathToFileURL(join(dist, "errors.js")).href
);

try {
  assertNativePackages();
} catch (error) {
  if (error instanceof UnsupportedPlatformError || error instanceof MissingPlatformPackageError) {
    console.log("UNSUPPORTED_SMOKE_OK", error.name, error.message);
    process.exit(0);
  }
  throw error;
}

throw new Error("expected createEngine natives to fail closed on this host");
