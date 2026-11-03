# ADR: Searchable scans are re-OCR'd

## Status

Accepted

## Context and forces

Scanners and tools such as Acrobat make scans searchable by drawing an invisible text layer (text rendering mode 3) over each page image. That layer is someone else's OCR, of unknown quality and language coverage, and it is not necessarily aligned with what the page shows.

pdf-inspector already treats such a page as needing OCR. The page-level extractor returns `needsOcr: true` with empty Markdown, and the classifier calls the document scanned or image-based. Its plain-text API (`extractText`) still returns the hidden layer. Reusing that layer would skip a few hundred milliseconds of OCR per page.

## Decision

A page whose only text is an invisible layer over a scan is OCR'd with the bundled light-ocr engine, the same as a scan without a layer. The invisible layer is never returned as the page's text. here-docs does not call pdf-inspector's plain-text API for such pages.

## Considered alternatives

- Use the invisible layer when present and OCR only pages without one. Rejected: output quality would depend on the tool that made the scan searchable, and a wrong or misaligned layer would pass through silently.
- Return both. Rejected: it duplicates every page.
- Make it a caller option. Rejected for now: one more knob without a user asking for it. Revisit if conversion time on large searchable archives matters.

## Trade-offs and consequences

- Searchable scans cost as much OCR time as plain scans.
- The rule is defined by pdf-inspector's page signals. A page that mixes visible native text with an invisible layer over part of the page is a text page to the extractor, and its invisible text is extracted with the visible text. Only pages whose text is entirely invisible are guaranteed to be re-OCR'd.
- `test/fixtures/pdf/searchable-scan.pdf` pins the behavior on the real engines.
