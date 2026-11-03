// Real-world corpus check: converts every public sample file in test/corpus/files/ with the real engines
// and checks the expected text listed in test/corpus/manifest.json. Each entry records the file's source.
//
//   npm run corpus                      every entry
//   npm run corpus -- --format ofd      one format
//   npm run corpus -- --write out/      also write each manuscript to out/<file>.md
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const manifest = JSON.parse(await readFile(join(here, "manifest.json"), "utf8"));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const onlyFormat = option("--format");
const writeDir = option("--write");

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
    const filename = entry.filename ?? entry.file.split("/").pop();
    let problems = [];
    try {
      const bytes = await readFile(join(here, entry.file));
      const result = await convert(bytes, { engine, filename, signal: AbortSignal.timeout(180_000) });
      // Hard line breaks (`\` at line end) and escapes do not change the text being checked.
      const text = result.markdown.replace(/\\(?=\n)|\\(?=[\\`*_[\]#|])/g, "");
      problems = [
        ...(entry.expect ?? []).filter((snippet) => !text.includes(snippet)).map((snippet) => `missing ${JSON.stringify(snippet)}`),
        ...(result.markdown.length < (entry.minChars ?? 1) ? [`only ${result.markdown.length} chars (expected at least ${entry.minChars ?? 1})`] : []),
        ...result.warnings
          .filter((warning) => !(entry.allowWarnings ?? []).includes(warning.code))
          .map((warning) => `warning ${warning.code}: ${warning.message.slice(0, 120)}`),
      ];
      if (writeDir) {
        const out = join(writeDir, `${entry.file.replace(/^files\//, "")}.md`);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, result.markdown);
      }
    } catch (error) {
      problems = [`error: ${error instanceof Error ? error.message : String(error)}`];
    }
    const status = problems.length === 0 ? "ok  " : "FAIL";
    console.log(`${status} ${entry.format.padEnd(6)} ${String(Date.now() - started).padStart(6)}ms  ${entry.file.replace(/^files\//, "")}`);
    for (const problem of problems) {
      console.log(`       ${problem}`);
    }
    if (problems.length > 0) {
      failures.push(entry.file);
    }
  }
} finally {
  await engine.close();
}

console.log(`\n${checked - failures.length}/${checked} corpus files passed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
