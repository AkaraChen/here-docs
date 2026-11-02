# Specification

## Product scope

`here-docs` converts supported local file bytes into one Markdown manuscript. The programmable API accepts only bytes. The CLI is the only surface that reads a filesystem path or stdin.

Out of scope: HTTP services, decrypting files, audio/video, directory batch conversion, and the programmable API reading paths.

## Terminology

- **Feature 质问**: the mandatory product-then-technical clarification loop driven by `$feature-dev` before implementation.
- **PRD**: a product requirements document under `docs/prd/` describing problem, users, goals, non-goals, flows, failure behavior, and acceptance criteria.
- **ADR**: an architecture decision record under `docs/adr/` capturing one material technical choice, alternatives, and consequences.
- **Spec**: this file — the single source of truth for shared terminology, observable contracts, and system-wide invariants.
- **Manuscript**: the Markdown string returned as `markdown`. It is the only top-level text product.
- **Warning**: a structured `{ code, message }` describing a skipped or degraded part. Warnings do not fail a completed conversion.
- **Strategy**: the routing choice for a detected input kind (image, office, PDF, or unknown).
- **Filename hint**: an optional name or extension used only to detect signature-less formats. It is never a path to read.
- **Engine**: the caller-owned handle from `createEngine()`. It must be passed to `convert()` and closed by the caller.
- **Part source**: where a part's Markdown came from — `text` (the document's own text), `ocr`, `mixed` (own text with OCR text of embedded images inserted in place), or `none` (nothing could be converted).
- **OCR reason**: why a PDF page was routed to OCR — `scanned-document`, `garbled-text`, `page-flagged`, or `extraction-failed`.

## Observable contracts

### Documentation harness

- New product behavior is defined in `docs/prd/` before feature code lands.
- Material technical choices are recorded in `docs/adr/` before or with the code that depends on them.
- Stable, implementation-independent rules merge into this `docs/spec.md`.
- Feature work that changes terminology, contracts, invariants, or failure behavior updates this file in the same change set.
- Agents must not implement feature code during 质问; the accepted PRD/ADR/spec set is the source of truth for implementation.

### convert

- `createEngine()` returns an engine the caller must close. It throws when the host is unsupported or a required native platform package cannot be resolved. Those failures are not convert warnings.
- `convert(input, options)` accepts `input` as `Uint8Array` (including Node `Buffer`) and requires `options.engine`. A string, missing bytes, or missing engine is an illegal call and throws.
- `convert()` never creates or closes an engine.
- `options.filename` is a format hint only.
- A completed call resolves to `{ markdown: string, warnings: Array<{ code: string, message: string }> }`.
- `markdown` is always a string. It may be empty when nothing useful could be extracted.
- Encrypted, unknown, or unconvertible inputs complete with empty `markdown` and at least one warning. They do not throw.
- Partial OCR or transcode failures add warnings and keep the rest of the manuscript.
- `options.signal` (an `AbortSignal`) cancels the call: it rejects with `signal.reason`. An abort is never reported as a warning, and the engine stays usable afterwards.

### convertPages

- `convertPages(input, options)` takes the same arguments as `convert()` and returns an async iterator of parts `{ page, pageCount, markdown, warnings, source, ocrReason }`.
- Every part has a `source`. `ocrReason` is set on PDF pages routed to OCR, including pages whose OCR failed (`source: "none"`), and is `null` on every other part.
- Illegal calls throw synchronously, before iteration starts.
- A PDF yields one part per page in page order: `page` is 1-based and `pageCount` is the document's page count. Other inputs yield exactly one part with `page: null` and `pageCount: null`.
- Work for a page happens only when that part is requested. Ending iteration early skips the remaining pages.
- `markdown` of a part has no trailing newline and may be empty. An OCR'd page on which nothing is recognized, such as a blank page, has empty `markdown`. Warnings belong to the part that produced them.
- `convert()` equals draining `convertPages()`: non-empty parts joined by a blank line plus a final newline, and all warnings in order.

### CLI

- The CLI reads either one filesystem path or stdin (`-`, or no path when stdin is not a TTY). Path and stdin are mutually exclusive.
- After bytes are read, the CLI creates an engine, calls the same `convert()` contract, and closes the engine. `--filename` / `--format` become the filename hint.
- Default output writes `markdown` to stdout and warnings to stderr. `--json` writes the convert result object to stdout.
- Unreadable path, empty stdin, or invalid usage exits 1 without calling `convert()`.
- A completed `convert()` exits 0, including empty Markdown with warnings.

### Input kinds

Supported bytes:

- Office and related documents: Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV.
- PDF.
- JPEG and PNG.
- WebP, TIFF, HEIC, and GIF when they can be transcoded locally to PNG.

Detection prefers content signatures. CSV and other signature-less formats require a filename hint.

### Routing invariants

- Raster images produce OCR Markdown only.
- Office documents produce structured Markdown. OCR text from embedded raster assets is inserted at the image’s original position.
- Text-based PDF pages produce structured Markdown and are not sent through whole-document OCR.
- On an extracted PDF page, OCR text of images large enough to hold text (at least 72 × 24 pt) is inserted as a block after the text above each image, and the part's source is `mixed`. Native text drawn over an image is not repeated. A failed image OCR keeps the page text and adds a `pdf-image-ocr-failed` warning.
- Scanned or image-only PDFs produce OCR Markdown.
- A scanned page whose only text is an invisible layer (a searchable scan) is OCR'd locally. The invisible layer is never returned as the page's text.
- Mixed PDFs include structured text for extractable pages and OCR text for pages that need OCR. Needing-OCR pages must not be dropped solely because structured extraction succeeded.
- A page needs OCR when either the document-level classification or the page-level extraction says so. When they disagree, OCR wins: a page with a little native text in a document classified as scanned or image-based is OCR'd, so its words survive without their structure rather than the scan being dropped.
- In a document that hides optional content (layers) by default, extracted text the rendered page does not show is left out, and text in shown layers stays. Documents without hidden layers are not OCR'd for this. A failed check keeps the page text and adds a `pdf-layer-check-failed` warning. When the check cannot judge a run, the run is kept.
- On extracted PDF pages, link annotations with an `http`, `https`, or `mailto` target become Markdown links on the words they cover. A link whose words cannot be found is appended to its page as an autolink. No other link scheme ever becomes a Markdown link.
- PDF page indexes from classification are 0-based. OCR page ranges are 1-based. Routing converts between them.
- PDF OCR runs one page per OCR request. The OCR engine's whole-request limits (input size, page count, total pixels) do not limit a PDF: a scanned PDF of any size and length is OCR'd page by page.
- A page too large to render within the OCR engine's per-page pixel limit is rendered at progressively lower resolutions before it becomes a page warning.

### Known limitations

- Hidden-layer text is detected by position. A hidden layer drawn at the same place as visible text, text under 8 pt, and runs on rotated pages are not removed. Pages from the whole-document fallback are not checked. See `docs/adr/hidden-layer-check.md`.

## System-wide constraints

- Repository agent entrypoint is root `AGENTS.md` (`CLAUDE.md` is a symlink to it).
- Feature development workflow skill lives at `.agents/skills/feature-dev/` (also linked from `.claude/skills/`).
- Commit attempts should re-check the working tree against this specification and relevant PRDs/ADRs before landing.
- Runtime is Node.js 22 or 24. Bun is supported as a consumer runtime: the `bun` export condition loads the TypeScript source, so no build step is needed.
- Conversion is local: no network service is required after install.
- Supported native hosts are `darwin-arm64`, `linux-x64-gnu`, `linux-arm64-gnu`, `linux-x64-musl`, `linux-arm64-musl`, and `win32-x64`. Every official platform package those engines publish is declared so installers on each host receive their matching addon. Optional dependencies must not be omitted.
- Continuous integration must exercise every supported host with a real engine start and convert, and must show that an unsupported host (Intel macOS) fails closed at startup.
- PDF routing invariants are verified against the real engines on handcrafted fixture PDFs with known content, not only against fakes.

## Current implementation status

- Local file-to-Markdown is specified in `docs/prd/local-file-to-markdown.md` and `docs/adr/`.
- Page iteration and cancellation are specified in `docs/prd/page-iteration.md` and `docs/adr/lazy-page-conversion.md`.
- Part provenance is specified in `docs/prd/part-provenance.md` and `docs/adr/part-provenance.md`.
- PDF links are specified in `docs/prd/pdf-links.md` and `docs/adr/pdf-link-splice.md`.
- OCR of images on PDF text pages is specified in `docs/prd/pdf-embedded-image-ocr.md` and `docs/adr/pdf-image-ocr.md`.
- Hidden PDF layers are specified in `docs/prd/hidden-pdf-layers.md` and `docs/adr/hidden-layer-check.md`.
- The programmable API and CLI implement the contracts in this file.
