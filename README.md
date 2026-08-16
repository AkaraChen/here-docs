# here-docs

Local any-file-to-Markdown for Node.js. Drop office documents, PDFs, or images in; get a Markdown manuscript back. Nothing leaves the machine.

## Install

Node.js 22 or 24 is required.

```bash
npm install here-docs
```

## Programmable API

`convert()` accepts **bytes only**. Read the file yourself. A string path is an illegal call and throws.

```ts
import { readFile } from "node:fs/promises";
import { convert } from "here-docs";

const { markdown, warnings } = await convert(await readFile("report.docx"), {
  filename: "report.docx",
});

console.log(markdown);
for (const warning of warnings) {
  console.warn(warning.code, warning.message);
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
| Scanned or image-only PDF | OCR Markdown. |
| Mixed PDF | Extractable pages stay structured; pages that need OCR are recognized and merged in page order. |
| JPEG, PNG | OCR only. |
| WebP, TIFF, HEIC, GIF | Transcoded to PNG, then OCR. Transcode failure is a warning, not a throw. |

CSV and other signature-less formats need `--filename` / `--format` or `options.filename`.

## Requirements

- Node.js 22 or 24
- Local native engines installed with the package: `@firecrawl/anydoc`, `@firecrawl/pdf-inspector`, `@arcships/light-ocr`, and `sharp`
- No network service after install

## Development

```bash
npm install
npm test
npm run build
node dist/cli.js --help
```

Product contracts live in [`docs/spec.md`](docs/spec.md). Requirements and routing decisions are in [`docs/prd/`](docs/prd/) and [`docs/adr/`](docs/adr/).
