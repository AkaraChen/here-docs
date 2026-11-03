# ADR: Hidden layers are checked against the rendered page

## Status

Accepted. Supersedes `hidden-optional-content.md`.

## Context and forces

pdf-inspector ignores optional content visibility. It extracts text from layers the document turns off by default, in its Markdown, plain text, and positioned items. PDFium, which light-ocr uses to render pages, honors the default configuration, so OCR of a rendered page never contains hidden-layer text. here-docs does not parse PDF structure, and resolving visibility exactly (OCMDs, nested marked content, form XObjects, inherited resources) would make it a second PDF parser.

Both halves are cheap to tell apart:

- Whether a document hides layers at all is visible in its bytes. It needs `/OCProperties` and a non-empty `/OFF` array or `/BaseState /OFF`, either in the raw file or inside a Flate object stream.
- Which runs are hidden shows in the render: a run no OCR line touches is not painted.

## Decision

- `hidesOptionalContent(bytes)` scans the raw bytes and the inflated object streams once per document. Most PDFs fail the scan and pay nothing more.
- For documents that pass, each text page is OCR'd once when it is requested, through `recognizeDocumentPages`. OCR line boxes are mapped into PDF points with the render transform (`pdf-geometry.ts`, shared with `pdf-image-ocr.md`).
- A text run is unseen when no OCR line box intersects its box. Unseen runs are removed from the page Markdown (first occurrence), lines left holding only markup are dropped, and the runs are excluded from link and image placement.
- Safety bounds, because a wrong removal deletes real text:
  - Only runs of at least 8 pt with at least three letters or digits, lying inside the crop box, are judged.
  - A page where OCR recognized nothing, whose boxes cannot be mapped (`/Rotate`), or where more than half of the judged runs look unseen is left untouched.
- An OCR failure keeps the text and adds `pdf-layer-check-failed`.

## Considered alternatives

- Keep it a known limitation and wait for upstream. Rejected: the product promise is the text a reader sees, and the fix fits the engines here-docs already has.
- Parse `/OC` marked content in content streams. Rejected: a partial PDF parser (compressed streams, forms, OCMD expressions) to maintain.
- pdf.js to compute visibility. Rejected: a second multi-megabyte PDF engine, and no reliable way to map pdf.js text items onto pdf-inspector's Markdown.
- OCR every text page of every document. Rejected: OCR cost on every PDF for a rare feature.

## Trade-offs and consequences

- Layered documents cost one OCR per text page.
- Text hidden at the same position as visible text (overlaid translations) is not detected. Small labels and short runs are never removed.
- Measured on 10 ordinary text PDFs from pdf-inspector's test corpus, checked as if they hid layers (2,055 runs on their first three pages): with the safety bounds, no run is removed. Without them, single glyphs, 7 pt chart labels, and every run of a page drawn under an unreported rotation would have been.
- If pdf-inspector starts honoring optional content, the check finds nothing to remove and can be retired.
