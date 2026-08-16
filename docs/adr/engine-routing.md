# ADR: Engine routing

## Status

Accepted

## Context and forces

Three local engines cover different parts of “any file to Markdown”:

- `@firecrawl/anydoc` converts office documents and text-based PDFs to Markdown. Image-only PDFs fail as `unsupported`. Mixed PDFs can succeed while silently dropping pages that need OCR.
- `@firecrawl/pdf-inspector` classifies PDFs (`TextBased` / `Scanned` / `ImageBased` / `Mixed`) and exposes `pagesNeedingOcr`. anydoc embeds this library but does not publish those fields on its Node API.
- `@arcships/light-ocr` OCRs JPEG, PNG, and PDF pages offline, with 1-based `pageRange`.

Catching anydoc errors alone cannot preserve mixed-PDF pages. The product contract requires best-effort completeness without a cloud OCR service.

## Decision

Use a strategy object per detected kind:

- Raster images (JPEG, PNG, and transcoded WebP/TIFF/HEIC/GIF) go to light-ocr only.
- Office, CSV, RTF, and EPUB go to anydoc `toDocument`, then light-ocr on embedded assets.
- PDFs go to pdf-inspector classification first. Text pages use inspector Markdown; pages in `pagesNeedingOcr` use light-ocr. Mixed documents are merged in page order.

anydoc `ConvertError.code` selects a recovery strategy; it does not by itself decide PDF routing.

## Considered alternatives

- anydoc plus light-ocr only, falling back on `unsupported`. Rejected: mixed PDFs return partial Markdown with no page list.
- OCR every PDF. Rejected: loses tables and headings on text PDFs and is slower.
- Run anydoc and full-document OCR on every PDF and concatenate. Rejected: duplicates text pages and is slower.

## Trade-offs and consequences

- A third native dependency is required. It is the same classifier anydoc already uses internally.
- pdf-inspector page indexes are 0-based; light-ocr `pageRange` is 1-based. Routing must convert explicitly.
- Encoding-issue flags from the inspector trigger extra OCR on those pages (best-effort).
- Strategies are unit-tested with injected fakes; native engines stay behind a narrow port.
