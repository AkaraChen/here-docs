// Real-world corpus check: downloads the public sample files listed in test/corpus/manifest.json
// (verified by SHA-256, cached in .corpus-cache/), converts each one with the real engines, and checks
// the expected text. The files themselves are not committed: they come from many projects and licenses.
//
//   npm run corpus                      every entry
//   npm run corpus -- --format ofd      one format
//   npm run corpus -- --write out/      also write each manuscript to out/<id>.md
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const cacheDir = process.env.HERE_DOCS_CORPUS_CACHE ?? join(root, ".corpus-cache");
const manifest = JSON.parse(await readFile(join(here, "manifest.json"), "utf8"));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const onlyFormat = option("--format");
const writeDir = option("--write");

async function fetchCached(entry) {
  const file = join(cacheDir, entry.sha256);
  if (existsSync(file)) {
    return readFile(file);
  }
  const bytes = await download(entry.url);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256) {
    throw new Error(`checksum mismatch for ${entry.id}: got ${digest}`);
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

/** Hosts such as Wikimedia rate-limit anonymous clients: identify, and back off on 429 and 5xx. */
async function download(url) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "here-docs-corpus/1.0 (https://github.com/AkaraChen/here-docs)" } });
    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }
    if (attempt >= 4 || (response.status !== 429 && response.status < 500)) {
      throw new Error(`download failed (${response.status}) ${url}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await new Promise((resolve) => setTimeout(resolve, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt * 2) * 1000));
  }
}

const { convert, createEngine } = await import(pathToFileURL(join(root, "dist", "index.js")).href);
const engine = await createEngine();
const failures = [];
let checked = 0;
try {
  for (const entry of manifest) {
    if (onlyFormat && entry.format !== onlyFormat) {
      continue;
    }
    checked += 1;
    const started = Date.now();
    let problems = [];
    try {
      const bytes = await fetchCached(entry);
      const result = await convert(bytes, { engine, filename: entry.filename, signal: AbortSignal.timeout(180_000) });
      // Hard line breaks (`\` at line end) and escapes do not change the text being checked.
      const text = result.markdown.replace(/\\(?=\n)|\\(?=[\\`*_[\]#|])/g, "");
      problems = [
        ...(entry.expect ?? []).filter((snippet) => !text.includes(snippet)).map((snippet) => `missing ${JSON.stringify(snippet)}`),
        ...(entry.reject ?? []).filter((snippet) => text.includes(snippet)).map((snippet) => `unexpected ${JSON.stringify(snippet)}`),
        ...(result.markdown.length < (entry.minChars ?? 1) ? [`only ${result.markdown.length} chars (expected at least ${entry.minChars ?? 1})`] : []),
        ...result.warnings
          .filter((warning) => !(entry.allowWarnings ?? []).includes(warning.code))
          .map((warning) => `warning ${warning.code}: ${warning.message.slice(0, 120)}`),
      ];
      if (writeDir) {
        await mkdir(writeDir, { recursive: true });
        await writeFile(join(writeDir, `${entry.id}.md`), result.markdown);
      }
    } catch (error) {
      problems = [`error: ${error instanceof Error ? error.message : String(error)}`];
    }
    const status = problems.length === 0 ? "ok  " : "FAIL";
    console.log(`${status} ${entry.format.padEnd(6)} ${String(Date.now() - started).padStart(6)}ms  ${entry.id}`);
    for (const problem of problems) {
      console.log(`       ${problem}`);
    }
    if (problems.length > 0) {
      failures.push(entry.id);
    }
  }
} finally {
  await engine.close();
}

console.log(`\n${checked - failures.length}/${checked} corpus files passed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
