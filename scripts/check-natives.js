import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const compiled = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "check-natives.js");
if (!existsSync(compiled)) {
  process.exit(0);
}
await import(pathToFileURL(compiled).href);
