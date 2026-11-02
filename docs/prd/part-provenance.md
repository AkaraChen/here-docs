# Part provenance

## Problem and context

`convertPages()` yields Markdown per page, but a caller cannot tell how a page was read. A page from a PDF's own text layer keeps headings and tables; an OCR'd page is plain lines with a `## Page N` heading, and its quality depends on the scan. Callers that score quality, budget OCR time, or decide whether to show a "scanned" badge had to guess from the Markdown.

The engines already know: pdf-inspector reports why a page needs OCR, and the routing in here-docs decides per page. That knowledge was discarded.

## Target users and stories

- A developer iterating `convertPages()` checks `part.source` to tell extracted pages from OCR'd ones, for example to flag low-confidence pages for review.
- A developer counts parts with `source: "ocr"` to estimate how much of a corpus is scanned.
- A developer reads `part.ocrReason` to tell a scanned document from a born-digital PDF whose fonts do not decode.

## Goals

- Every part says where its Markdown came from.
- Every PDF page that was routed to OCR says why, in a small, stable vocabulary owned by here-docs.

## Non-goals

- Exposing pdf-inspector's own reason strings or confidence scores. They are engine details and change between versions.
- OCR confidence per line or per page.
- Provenance on `convert()`'s result. It joins parts into one manuscript, and the CLI's `--json` prints that result unchanged.

## Scope and user flow

1. The caller iterates `convertPages()` as before.
2. Each part carries `source`: `text`, `ocr`, `mixed`, or `none`.
3. Each part carries `ocrReason`: one of `scanned-document`, `garbled-text`, `page-flagged`, `extraction-failed` on PDF pages routed to OCR, and `null` everywhere else.

## User-visible states and failure behavior

- `text`: the Markdown came from the document's own text (an office document without OCR'd images, a PDF text page, the whole-document PDF fallback).
- `ocr`: the Markdown came from OCR (a raster image, an OCR'd PDF page). It may be empty when nothing was recognized.
- `mixed`: the document's own text, with OCR text of embedded images inserted in place.
- `none`: nothing could be converted (unknown, encrypted, or unconvertible input, a failed image OCR or transcode, a PDF page whose OCR failed). Warnings explain why.
- A PDF page whose OCR failed has `source: "none"` and keeps the `ocrReason` it was sent to OCR for.

## Minimum acceptance criteria

- A text PDF's pages are `text` with `ocrReason: null`.
- A scanned PDF's pages are `ocr` with `ocrReason: "scanned-document"`.
- In a mixed PDF, the flagged page is `ocr` with `page-flagged`, and the other pages are `text`.
- A page whose text layer does not decode is `ocr` with `garbled-text`.
- Pages whose batch failed to extract are `ocr` with `extraction-failed`.
- A raster image is `ocr`. An office document is `text`, or `mixed` when OCR text of an embedded image was inserted.
- Unknown and encrypted inputs are `none`.

## Exclusions and resolved product decisions

- The reason vocabulary belongs to here-docs. New engine reasons map onto it or onto `page-flagged`. Adding a reason is a contract change.
- `ocrReason` describes routing, not success: it stays set when OCR fails.
- `convert()` and the CLI output are unchanged.
