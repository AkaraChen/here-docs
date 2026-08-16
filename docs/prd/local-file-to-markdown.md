# Local file to Markdown

## Problem and context

Callers receive mixed office documents, PDFs, and images and need a readable text manuscript without leaving the machine. Digital office files already convert locally; scanned pages and raster images do not. This product joins those paths into one local convert call.

## Target users and stories

- A developer embeds `convert(bytes)` in a Node.js program and receives Markdown plus warnings.
- A developer tests the same contract from a CLI by passing a path or piping stdin.

## Goals

- Convert a supported file to one Markdown manuscript, locally, with no network requirement at runtime.
- Route automatically: office documents through structured conversion plus embedded-image OCR; raster images through OCR only; PDFs through text extraction and per-page OCR where needed.
- Stay best-effort: return whatever manuscript can be produced, with warnings for skipped parts.

## Non-goals

- HTTP or other network services.
- A public reusable OCR session API.
- Decrypting password-protected files.
- Audio, video, or directory batch conversion.
- The programmable API reading filesystem paths or accepting a string as file content.

## Scope and user flow

1. The programmable API receives file bytes and an optional filename hint.
2. The library detects the kind of input and selects a strategy.
3. The strategy produces Markdown. Embedded raster assets and scanned PDF pages are OCR'd and inserted at their source positions.
4. The caller receives `{ markdown, warnings }`.
5. The CLI is the only surface that reads a path or stdin. It then calls the same `convert()` contract.

Supported v1 inputs:

- Office and related documents that anydoc can parse (Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV).
- PDF.
- JPEG and PNG.
- WebP, TIFF, HEIC, and GIF after a local raster transcode to PNG.

## User-visible states and failure behavior

- Success: `markdown` is a string, possibly empty, and `warnings` lists skipped pages, assets, transcodes, or unsupported/encrypted inputs.
- Illegal call: the programmable API throws when it is not given bytes.
- CLI I/O failure: unreadable path, empty stdin, or invalid usage exits 1 and does not call `convert()`.
- Encrypted, unknown, or unconvertible input: `markdown` is empty and a warning is present. The API does not throw.
- Single-page or single-asset OCR failure: that part is skipped, a warning is recorded, and the rest of the manuscript is returned.
- Internal OCR inference failures are retried once before the part is skipped.

## Minimum acceptance criteria

- An office document yields structured Markdown; OCR text from embedded JPEG/PNG (and transcodable images) appears at the original image position, not only as an appendix.
- A raster image yields Markdown produced only by OCR.
- A text-based PDF yields structured Markdown and is not sent through whole-document OCR.
- A scanned or image-only PDF yields OCR Markdown.
- A mixed PDF includes OCR text for pages that need OCR and keeps structured text for extractable pages.
- WebP/TIFF/HEIC/GIF transcode when possible; otherwise a warning and no throw.
- Encrypted or unknown types return empty Markdown plus a warning and do not throw.
- `convert()` accepts only bytes; a string argument is an illegal call.
- The CLI accepts a filesystem path or stdin (`-` or a pipe). `--json` prints the same `{ markdown, warnings }` object as the API.

## Exclusions and resolved product decisions

- Output is always Markdown, never a raw OCR line array as the top-level contract.
- Filename on `convert()` is only a format hint (especially CSV), never a path to read.
- Path and stdin are mutually exclusive on the CLI.
- A completed `convert()` — including empty Markdown with warnings — is a successful CLI run (exit 0).
