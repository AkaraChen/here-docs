# ADR: Lazy page conversion

## Status

Accepted

## Context and forces

Callers need to stop after a number of pages and to cancel running conversions (see `docs/prd/page-iteration.md`). The engines allow both:

- `@firecrawl/pdf-inspector` `extractPagesMarkdown(buffer, pages)` extracts a chosen list of 0-based pages.
- `@arcships/light-ocr` `recognizeDocument` takes a 1-based `pageRange` and an `AbortSignal`, and checks the signal before each page render and OCR inference. `recognizeEncoded` takes a signal too.

Whole-document OCR also has hard per-request limits in light-ocr (`maxPages` 100, `maxTotalPixels` 100 Mi), so one request for a long scan fails as a whole.

## Decision

- Strategies are async generators of `ConvertPart`. `convertPages()` returns that generator; `convert()` drains it.
- PDFs: classify once, then walk pages in order. Text is extracted in two calls: the first 8 pages, then every remaining page. pdf-inspector pays a whole-document parse on each page-extraction call, whatever the number of pages. In 1.14.2, on a 269-page document, one page takes 6.5 s and all pages 11.5 s. A small first call keeps an early stop as cheap as the extractor allows, and one more call covers the rest. Pages that need OCR are OCR'd one page per request, when reached.
- Scanned and image-only PDFs are OCR'd one page per request as well. That keeps every request under light-ocr's page-count and total-pixel limits, at the cost of reopening the document per page, which is small next to OCR itself. The input-size and per-page pixel limits are handled in `ocr-resource-limits.md`.
- `options.signal` is checked before each step and passed to every OCR call. `catch` blocks that turn failures into warnings rethrow when the signal is aborted.
- If per-page extraction is unavailable for the first batch, fall back to whole-document `process()` as one part, followed by the OCR'd pages. If extracting the rest at once fails, it is retried 64 pages at a time, so a page that breaks extraction costs only its chunk. A chunk that fails again is OCR'd instead of dropped.

## Considered alternatives

- A `maxPages` option on `convert()`. Rejected: one more knob, and it does not cover deadlines; an iterator plus a signal covers both.
- Keep one whole-document OCR request and raise light-ocr's limits. Rejected: still not lazy, and the limits exist to bound memory.
- Extract every page's text in one call. Rejected: the call costs about as much as the whole document either way, but the first page then waits for all of them (11.5 s instead of 6.5 s on the 269-page document). Two calls cost one extra parse and keep the first page quick.

## Trade-offs and consequences

- A page whose OCR fails is reported per page (`pdf-page-ocr-failed`) instead of failing the whole scan (`ocr-failed`).
- Native calls that are already running finish before the abort is observed.
- Positioned items (links and images, see `pdf-link-splice.md` and `pdf-image-ocr.md`) are read 64 text pages at a time, when the first of them is reached. That call is synchronous and its cost grows with the pages requested. Image OCR and the hidden-layer check on a text page run when that page is requested.
- Batches that doubled from 8 to 64 pages were replaced. Each batch re-paid the whole-document parse, so a full run of the 269-page document took 61 s. With two calls it takes 25 s. The cost: stopping after page 9 still extracts every page's text (not OCR).
- Page order is preserved; pages are not processed in parallel.
