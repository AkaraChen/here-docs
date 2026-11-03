# ADR: Part provenance

## Status

Accepted

## Context and forces

Routing decides per page whether to extract or OCR (`engine-routing.md`, `lazy-page-conversion.md`), and pdf-inspector says why a page needs OCR through `PageMarkdownResult.ocrReason`. In 1.14.2 it names only `suspected_garbled_text` per page; later versions add `scanned`, `no_text`, `vector_text`, and `invisible_text_layer`. Document-level classification (`classifyPdf`) reports no reasons at all.

## Decision

- `ConvertPart` gains `source: "text" | "ocr" | "mixed" | "none"` and `ocrReason: OcrReason | null`. Both are exported types.
- `OcrReason` is a here-docs vocabulary derived from the routing decision:
  - `scanned-document`: the classifier called the whole document scanned or image-based, so every page is OCR'd.
  - `garbled-text`: page extraction reported `suspected_garbled_text`.
  - `page-flagged`: the classifier's page list or page extraction's `needsOcr` flagged the page, with no more specific reason.
  - `extraction-failed`: the page's extraction batch failed.
- Each strategy sets `source` where it builds a part. The PDF strategy sets `ocrReason` where it decides to OCR.

## Considered alternatives

- Pass pdf-inspector's reason strings through. Rejected: the vocabulary changes between engine versions, is absent for whole-document routing, and would make an engine upgrade a breaking change.
- A boolean `ocr` flag. Rejected: it cannot express office documents with OCR'd images (`mixed`) or failed parts (`none`).
- Put provenance on `ConvertResult`. Rejected: a manuscript joins parts of different provenance; there is no single honest value.

## Trade-offs and consequences

- `garbled-text` is detected only when the page extractor names it; other engine reasons collapse into `page-flagged` until the vocabulary is extended on purpose.
- Strategies cannot build a part without choosing a `source`, so new routes cannot forget it.
