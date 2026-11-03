# ADR: OCR resource limits for PDF pages

## Status

Accepted

## Context and forces

light-ocr guards every PDF request with limits and rejects a violation with `resource_limit_exceeded` (`@arcships/light-ocr` 0.5.9 defaults):

| Limit | Default | Checked |
| --- | --- | --- |
| `maxFileBytes` | 100 MiB | per request, on the input bytes |
| `maxPages` | 100 | per request |
| `maxTotalPixels` | 100 Mi | per request, summed over rendered pages |
| `maxPagePixels` | 4096 × 4096 | per page, before rendering, at the request's `dpi` (default 150) |

Lazy page conversion already OCRs one page per request, which keeps a request under `maxPages` and `maxTotalPixels`. It did not escape the other two:

- Every page request carries the whole PDF, so a scanned PDF over 100 MiB failed on every page and returned empty Markdown with one warning per page.
- A large-format page (posters, engineering drawings; about 27 inches on a side at 150 dpi) failed alone.

The spec claimed that per-page OCR made scans independent of the engine's per-request limits. That was true only for page count and total pixels.

## Decision

- PDF OCR requests pass `maxFileBytes` equal to the input length. The caller already holds the bytes in memory, so the cap protects nothing here.
- `maxPages` (to light-ocr's ceiling of 10 000) and `maxTotalPixels` are lifted, so the whole-document fallback for scans without a known page count is not cut short either.
- `maxPagePixels` stays at its default, because it bounds the memory of one rendered page. A page that exceeds it is retried at 75 dpi and then at 36 dpi, light-ocr's minimum. Each halving quarters the pixels. A page still too large becomes a `pdf-page-ocr-failed` warning, like any other failed page.
- The retry is driven by the error code, not the message. Pixels are checked before rendering, so a failed attempt is cheap.

## Considered alternatives

- Raise `maxPagePixels`. Rejected: one oversized page could allocate hundreds of megabytes, and the detection model downscales large inputs anyway.
- Compute the exact resolution from the page size. Rejected: the page size is not available before the first attempt, and parsing it out of the error message is brittle.
- Send each page as its own one-page PDF. Rejected: here-docs does not rewrite PDFs, and this would not fix the per-page pixel limit.

## Trade-offs and consequences

- Large-format pages are OCR'd at a lower resolution, so small print on them may be lost; the page still yields what can be read.
- Each page request still hands the whole PDF to the engine, so a very large PDF is reopened once per OCR'd page (see `lazy-page-conversion.md`).
- Raster image inputs (`recognizeEncoded`) keep light-ocr's image limits. This decision covers PDF pages only.
