# here-docs

Local any-file-to-Markdown for Node.js. Drop office documents, PDFs, or images in; get a Markdown manuscript back. Nothing leaves the machine.

## Install

Node.js 22 or 24 is required. Install from GitHub; the package is not published to the npm registry.

```bash
npm install github:AkaraChen/here-docs
```

or in `package.json`:

```json
"here-docs": "github:AkaraChen/here-docs"
```

```json
"here-docs": "git+https://github.com/AkaraChen/here-docs.git"
```

Git and local installs run `prepare` (`tsc`) so `dist/` exists before the package is linked.

Bun resolves the `bun` export condition (listed first, so TypeScript with `customConditions: ["bun"]` type-checks against the same source) to the TypeScript source (`src/index.ts`), so a Bun install needs no build step: `bun add github:AkaraChen/here-docs` works even though Bun does not run `prepare` for untrusted dependencies. Bun 1.4 or later is tested in CI on Linux x64. A `bun build --compile` executable can load here-docs from a `node_modules` directory on disk only when it is built with `--compile-autoload-package-json` (off by default): without it the executable ignores `package.json` at runtime, so packages with an `exports` map or a `.node` entry point do not resolve. Pass an absolute path, e.g. `import(Bun.resolveSync("here-docs", dir))`. To ship a single file, embed that `node_modules` tree with `with { type: "file" }` imports and extract it to a cache directory before importing; native libraries (`.node`, `.so`) can only be loaded from real files.

## Programmable API

`convert()` accepts **bytes only** and a caller-owned **engine**. Read the file yourself. Create and close the engine yourself. A string path or a missing engine is an illegal call and throws.

```ts
import { readFile } from "node:fs/promises";
import { convert, createEngine } from "here-docs";

const engine = await createEngine();
try {
  const { markdown, warnings } = await convert(await readFile("report.docx"), {
    filename: "report.docx",
    engine,
  });

  console.log(markdown);
  for (const warning of warnings) {
    console.warn(warning.code, warning.message);
  }
} finally {
  await engine.close();
}
```

`filename` is a format hint (needed for signature-less inputs like CSV). It is never used to read a path.

A completed call always returns:

```ts
{
  markdown: string
  warnings: Array<{ code: string; message: string }>
}
```

Encrypted, unknown, or unconvertible inputs resolve with empty `markdown` and at least one warning. They do not throw. Partial OCR or transcode failures keep the rest of the manuscript.

### Page by page

`convertPages()` takes the same arguments and yields the manuscript one part at a time. A PDF yields one part per page, in order, and each page is extracted or OCR'd only when you ask for it, so breaking out of the loop skips the rest. Other inputs yield a single part with `page: null`.

```ts
import { convertPages } from "here-docs";

const parts = [];
for await (const part of convertPages(bytes, { filename: "scan.pdf", engine })) {
  // part: { page: number | null, pageCount: number | null, markdown: string, warnings }
  parts.push(part.markdown);
  if (parts.length === 5) break; // pages 6+ are never OCR'd
}
```

### Cancellation

Both `convert()` and `convertPages()` accept `signal`. Aborting rejects the call (or the pending iterator step) with `signal.reason`; it is not reported as a warning, and the engine stays usable. A native call that is already running finishes first, so the abort lands within about one page.

```ts
const result = await convert(bytes, { engine, signal: AbortSignal.timeout(30_000) });
```

## CLI

The CLI is the only surface that reads a path or stdin.

```bash
npx here-docs report.docx
npx here-docs scan.pdf -o out.md
npx here-docs image.heic --json
npx here-docs - < report.docx
cat scan.pdf | npx here-docs --filename scan.pdf
```

| Option | Meaning |
| --- | --- |
| `-o, --output <file>` | Write the manuscript to a file |
| `--json` | Print `{ markdown, warnings }` |
| `--filename <name>` | Format hint (also for stdin) |
| `--format <ext>` | Format hint extension |

Path and stdin are mutually exclusive. Markdown goes to stdout; warnings go to stderr unless `--json` is set. Unreadable path, empty stdin, or invalid usage exits `1` without converting. A finished conversion exits `0`, including empty Markdown with warnings.

## What gets routed where

Detection prefers content signatures over the filename.

| Input | What happens |
| --- | --- |
| Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV | Structured Markdown via anydoc. Embedded raster images are OCR'd and inserted at the original image position. |
| Text-based PDF | Structured Markdown. The whole file is not sent through OCR. |
| Scanned or image-only PDF | OCR Markdown, one page per OCR request, so long scans are not cut off by OCR limits. |
| Mixed PDF | Extractable pages stay structured; pages that need OCR are recognized and merged in page order. |
| JPEG, PNG | OCR only. |
| WebP, TIFF, HEIC, GIF | Transcoded to PNG, then OCR. Transcode failure is a warning, not a throw. |

CSV and other signature-less formats need `--filename` / `--format` or `options.filename`.

## Requirements

- Node.js 22 or 24
- A supported native host: **macOS arm64**, **Linux x64/arm64** (glibc or musl/Alpine), or **Windows x64**. Optional platform packages must be installed (do not use `--omit=optional`).
- Local native engines installed with the package: `@firecrawl/anydoc`, `@firecrawl/pdf-inspector`, `@arcships/light-ocr`, and `sharp`
- No network service after install

Intel macOS and Windows ARM are not supported: at least one upstream engine does not publish that binary. `createEngine()` throws instead of returning a half-working engine.

## Development

```bash
npm install
npm test
npm run smoke
npm run build
node dist/cli.js --help
```

CI runs unit tests and a real `createEngine()` / `convert()` / CLI smoke on every supported host (Linux x64 and arm64 on glibc and in Alpine/musl, macOS arm64, Windows x64) for Node 22 and 24. Intel macOS is checked only to confirm startup fails closed.

Product contracts live in [`docs/spec.md`](docs/spec.md). Requirements and routing decisions are in [`docs/prd/`](docs/prd/) and [`docs/adr/`](docs/adr/).
