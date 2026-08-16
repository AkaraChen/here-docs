# Specification

## Product scope

`here-docs` converts supported local file bytes into one Markdown manuscript. The programmable API accepts only bytes. The CLI is the only surface that reads a filesystem path or stdin.

Out of scope: HTTP services, a public OCR session API, decrypting files, audio/video, directory batch conversion, and the programmable API reading paths.

## Terminology

- **Feature 质问**: the mandatory product-then-technical clarification loop driven by `$feature-dev` before implementation.
- **PRD**: a product requirements document under `docs/prd/` describing problem, users, goals, non-goals, flows, failure behavior, and acceptance criteria.
- **ADR**: an architecture decision record under `docs/adr/` capturing one material technical choice, alternatives, and consequences.
- **Spec**: this file — the single source of truth for shared terminology, observable contracts, and system-wide invariants.
- **Manuscript**: the Markdown string returned as `markdown`. It is the only top-level text product.
- **Warning**: a structured `{ code, message }` describing a skipped or degraded part. Warnings do not fail a completed conversion.
- **Strategy**: the routing choice for a detected input kind (image, office, PDF, or unknown).
- **Filename hint**: an optional name or extension used only to detect signature-less formats. It is never a path to read.

## Observable contracts

### Documentation harness

- New product behavior is defined in `docs/prd/` before feature code lands.
- Material technical choices are recorded in `docs/adr/` before or with the code that depends on them.
- Stable, implementation-independent rules merge into this `docs/spec.md`.
- Feature work that changes terminology, contracts, invariants, or failure behavior updates this file in the same change set.
- Agents must not implement feature code during 质问; the accepted PRD/ADR/spec set is the source of truth for implementation.

### convert

- `convert(input, options?)` accepts `input` as `Uint8Array` (including Node `Buffer`). A string or missing bytes is an illegal call and throws.
- `options.filename` is a format hint only.
- A completed call resolves to `{ markdown: string, warnings: Array<{ code: string, message: string }> }`.
- `markdown` is always a string. It may be empty when nothing useful could be extracted.
- Encrypted, unknown, or unconvertible inputs complete with empty `markdown` and at least one warning. They do not throw.
- Partial OCR or transcode failures add warnings and keep the rest of the manuscript.

### CLI

- The CLI reads either one filesystem path or stdin (`-`, or no path when stdin is not a TTY). Path and stdin are mutually exclusive.
- After bytes are read, the CLI calls the same `convert()` contract. `--filename` / `--format` become the filename hint.
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
- Scanned or image-only PDFs produce OCR Markdown.
- Mixed PDFs include structured text for extractable pages and OCR text for pages that need OCR. Needing-OCR pages must not be dropped solely because structured extraction succeeded.
- PDF page indexes from classification are 0-based. OCR page ranges are 1-based. Routing converts between them.

## System-wide constraints

- Repository agent entrypoint is root `AGENTS.md` (`CLAUDE.md` is a symlink to it).
- Feature development workflow skill lives at `.agents/skills/feature-dev/` (also linked from `.claude/skills/`).
- Commit attempts should re-check the working tree against this specification and relevant PRDs/ADRs before landing.
- Runtime is Node.js 22 or 24.
- Conversion is local: no network service is required after install.

## Current implementation status

- Local file-to-Markdown is specified in `docs/prd/local-file-to-markdown.md` and `docs/adr/`.
- The programmable API and CLI implement the contracts in this file.
