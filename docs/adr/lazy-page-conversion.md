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
- PDFs: classify once, then walk pages in order. Text pages are extracted in batches of 8, doubling up to 64, so an early stop parses little and a full run does not re-parse per page. Pages that need OCR are OCR'd one page per request, when reached.
- Scanned and image-only PDFs are OCR'd one page per request as well. That keeps every request under light-ocr's page-count and total-pixel limits, at the cost of reopening the document per page, which is small next to OCR itself. The input-size and per-page pixel limits are handled in `ocr-resource-limits.md`.
- `options.signal` is checked before each step and passed to every OCR call. `catch` blocks that turn failures into warnings rethrow when the signal is aborted.
- If per-page extraction is unavailable for the first batch, fall back to whole-document `process()` as one part, followed by the OCR'd pages. If a later batch fails, its pages are OCR'd instead of dropped.

## Considered alternatives

- A `maxPages` option on `convert()`. Rejected: one more knob, and it does not cover deadlines; an iterator plus a signal covers both.
- Keep one whole-document OCR request and raise light-ocr's limits. Rejected: still not lazy, and the limits exist to bound memory.
- Extract all text pages up front. Rejected: an early stop still parses the whole document.

## Trade-offs and consequences

- A page whose OCR fails is reported per page (`pdf-page-ocr-failed`) instead of failing the whole scan (`ocr-failed`).
- Native calls that are already running finish before the abort is observed.
- Each batch of text pages also reads their positioned items once (links and images, see `pdf-link-splice.md` and `pdf-image-ocr.md`), so the batch is still the unit of native extraction work. Image OCR and the hidden-layer check on a text page run when that page is requested.
- Page order is preserved; pages are not processed in parallel.
- pdf-inspector pays a whole-document pass on every page-extraction call, however few pages it is asked for, so each batch re-pays it. 1.25.2 makes the pass several times cheaper than 1.14.2: on a 269-page document a call drops from about 8 s to 1.2 s, and the full run from 61 s to 11 s. Documents with heavy tables still pay tens of seconds per batch. A 430-page one takes about 47 s per call.
