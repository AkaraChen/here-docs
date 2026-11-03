# here-docs

Local any-file-to-Markdown for Node.js. Drop in office documents, PDFs, OFD, e-mail, web pages, notebooks, text, or images, and get a Markdown manuscript back. Nothing leaves the machine.

## Install

Node.js 22 or 24 is required.

```bash
npm install here-docs
```

Releases are published from GitHub Actions with npm trusted publishing, so every version carries a provenance statement linking it to the commit and workflow run that built it. Installing straight from GitHub (`npm install github:AkaraChen/here-docs`) still works for unreleased commits.

The published package ships `dist/`. Git and local installs run `prepare` (`tsc`) so `dist/` exists before the package is linked.

Bun resolves the `bun` export condition (listed first, so TypeScript with `customConditions: ["bun"]` type-checks against the same source) to the TypeScript source (`src/index.ts`), so a Bun install needs no build step: `bun add here-docs` (or `bun add github:AkaraChen/here-docs`) works even though Bun does not run `prepare` for untrusted dependencies. Bun 1.4 or later is tested in CI on Linux x64. `bun build --compile` executables cannot load the native engines from disk; run under `bun` instead.

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

`filename` is a format hint (needed for CSV and TSV to become tables). It is never used to read a path.

A completed call always returns:

```ts
{
  markdown: string
  warnings: Array<{ code: string; message: string }>
}
```

Encrypted, unknown, or unconvertible inputs resolve with empty `markdown` and at least one warning. They do not throw. Partial OCR or transcode failures keep the rest of the manuscript.

### Page by page

`convertPages()` takes the same arguments and yields the manuscript one part at a time. A PDF, an OFD, or a multi-page TIFF yields one part per page, in order, and each page is extracted or OCR'd only when you ask for it, so breaking out of the loop skips the rest. Other inputs yield a single part with `page: null`.

```ts
import { convertPages } from "here-docs";

const parts = [];
for await (const part of convertPages(bytes, { filename: "scan.pdf", engine })) {
  // part: { page, pageCount, markdown, warnings, source, ocrReason }
  parts.push(part.markdown);
  if (parts.length === 5) break; // pages 6+ are never OCR'd
}
```

Each part says where its Markdown came from. `source` is `text` (the document's own text), `ocr`, `mixed` (the document's text with OCR text of embedded images inserted), or `none` (nothing could be converted; see `warnings`). A PDF page that was OCR'd also has `ocrReason`: `scanned-document`, `garbled-text` (its text layer does not decode), `page-flagged`, or `extraction-failed`. Everything else has `ocrReason: null`.

### Cancellation

Both `convert()` and `convertPages()` accept `signal`. Aborting rejects the call (or the pending iterator step) with `signal.reason`; it is not reported as a warning, and the engine stays usable. A native call that is already running finishes first, so the abort lands within about one page.

```ts
const result = await convert(bytes, { engine, signal: AbortSignal.timeout(30_000) });
```

### Large and untrusted inputs

- **Size.** PDF pages are OCR'd one per request, so the OCR engine's whole-request limits do not apply: a 100+ MiB or 1000-page scan converts every page. A page too large to render at 150 dpi (a poster or drawing) is retried at 75 and 36 dpi; if it still does not fit, that page is skipped with a `pdf-page-ocr-failed` warning.
- **Time.** Pass `signal: AbortSignal.timeout(ms)` to bound a conversion. Classification, text extraction, and a single page's OCR are native calls that finish before the abort is seen.
- **Pages.** Use `convertPages()` and stop iterating to cap work by page count. Pages you never request are never extracted or OCR'd.
- **Memory.** The input stays in memory for the whole conversion. Each OCR'd PDF page is rendered at up to 4096 × 4096 pixels.

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

Detection prefers content. Binary signatures come first, then the filename hint, then text markers (HTML, SVG, e-mail headers, notebook JSON). Anything else that decodes as text is converted as plain text.

| Input | What happens |
| --- | --- |
| Word, PowerPoint, Excel, OpenDocument (and their templates), Kingsoft WPS binaries, RTF, EPUB | Structured Markdown via anydoc. Embedded raster and SVG images are OCR'd and inserted at the original image position. |
| CSV, TSV | A table. Legacy encodings (GBK, Big5, Shift_JIS, ...) are decoded first. Without a filename hint they are converted as plain text. |
| Text-based PDF | Structured Markdown. The whole file is not sent through OCR. Web and mail link annotations become Markdown links. |
| Scanned or image-only PDF | OCR Markdown, one page per OCR request, so long or large scans are not cut off by OCR limits. |
| Mixed PDF | Extractable pages stay structured; pages that need OCR are recognized and merged in page order. |
| OFD (e-invoices, official documents) | One part per page. Text, including template text, comes out in reading order; image-only pages are OCR'd. |
| HTML, XHTML | Headings, lists, tables, quotes, code, and links. Layout tables render as content. `data:` images are OCR'd in place; remote images are never fetched. |
| E-mail (`.eml`, Outlook `.msg`) | Subject, From/To/Cc/Date, the body (inline `cid:` images OCR'd in place), then every attachment converted under its own heading, nested messages included (up to three levels deep). |
| Web archive (`.mht`, `.mhtml`) | The archived page as HTML; archived images are OCR'd in place. |
| Jupyter notebook | Markdown cells as written, code cells fenced, outputs as text, tables, or OCR text. |
| Plain text, Markdown | Decoded (any detectable encoding) and passed through unescaped. |
| JPEG, PNG | OCR only. |
| WebP, TIFF, HEIC/HEIF, AVIF, BMP, GIF | Decoded to PNG, then OCR. Each TIFF page is its own part. iPhone HEIC photos use a WebAssembly decoder. Failure is a warning, not a throw. |
| SVG | The text the drawing contains, including Mermaid and draw.io labels; drawings without text are rendered and OCR'd. |

HTML or tab-separated text saved under an Office name (`export.xls`, `report.wps`), as business systems often produce, converts by its content.

Deliberately unsupported: Apple iWork, InDesign, LaTeX and other pandoc markups, HWP, XPS, Visio/OneNote/Publisher, MOBI/DjVu, and archives. See [`docs/prd/format-coverage.md`](docs/prd/format-coverage.md).

Known limitation: on text PDF pages, text in layers (optional content) that the document hides by default is extracted as if visible. The PDF text extractor does not honor layer visibility yet.

## Requirements

- Node.js 22 or 24
- A supported native host: **macOS arm64**, **Linux x64/arm64** (glibc or musl/Alpine), or **Windows x64**. Optional platform packages must be installed (do not use `--omit=optional`).
- Local native engines installed with the package: `@firecrawl/anydoc`, `@firecrawl/pdf-inspector`, `@arcships/light-ocr`, and `sharp`. HTML, e-mail, OFD, notebooks, encodings, and HEIC are handled by pure-JavaScript dependencies, so they add no native packages.
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

`npm run corpus` converts several hundred public real-world files (e-mail from a dozen mail clients, OFD invoices, legacy-encoded text and CSV, saved web pages, notebooks, TIFF scans, HEIC/AVIF photos, SVG diagrams, Office templates, and Kingsoft WPS files) with the real engines and checks the expected text. The files live in `test/corpus/files/`, so the check runs offline; [`test/corpus/manifest.json`](test/corpus/manifest.json) lists each file's source and expected text. They are third-party test files kept under their original projects' licenses and are not part of the npm package.

CI runs unit tests and a real `createEngine()` / `convert()` / CLI smoke on every supported host (Linux x64 and arm64 on glibc and in Alpine/musl, macOS arm64, Windows x64) for Node 22 and 24. Intel macOS is checked only to confirm startup fails closed.

Product contracts live in [`docs/spec.md`](docs/spec.md). Requirements and routing decisions are in [`docs/prd/`](docs/prd/) and [`docs/adr/`](docs/adr/).
