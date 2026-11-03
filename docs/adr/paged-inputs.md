# ADR: Paged inputs beyond PDF

## Status

Accepted

## Context and forces

`convertPages()` yields one part per PDF page and one part for everything else (`docs/adr/lazy-page-conversion.md`). Two new inputs are paged documents too:

- **Multi-page TIFF**, the classic format for fax, legal productions, and archival scans. sharp decodes only the first page by default, so v1 silently dropped every page after the first.
- **OFD**, China's national fixed-layout format (GB/T 33190), used for e-invoices and official documents. Like PDF, it stores positioned text on pages, and some files contain only scanned images.

## Decision

- **TIFF**: the image adapter reports the page count. A TIFF with more than one page yields one part per page (`page` 1..N, `pageCount` N). Each page is decoded and OCR'd only when it is requested, and the Markdown uses the same `## Page n` heading as scanned PDF pages. Like them, a page on which nothing is recognized has empty Markdown, not a bare heading. Single-page images still yield one `page: null` part. Animated GIF frames are not pages.
- **OFD**: the package is parsed once (its XML parts only). Each page then yields one part, in document order and on demand:
  - The text objects of the page and of the template pages it references are placed by absolute position: boundary plus text-code offset, transformed by the object's matrix. Composite objects (shared graphic units from the resources, which some producers use for whole pages) contribute their text through their own matrix and boundary, nested at most eight deep. Text is grouped into lines by baseline and ordered left to right, with a space inserted where the horizontal gap exceeds about half a glyph.
  - A page with no text but with images is OCR'd image by image, in reading order, under a `## Page n` heading like a scanned PDF page. Images on text pages (logos, seals) are not OCR'd, matching the rule that text pages are not sent through OCR.
  - Annotations, signatures, and custom tags are ignored.
- Package paths are resolved relative to the referencing file, then to the package root, then case-insensitively, because real producers disagree on all three.

## Considered alternatives

- **Render OFD pages and OCR them.** Rejected: there is no local OFD renderer, and OCR would lose the exact text the file already stores.
- **Read OFD text in XML order.** Rejected: producers write objects in arbitrary order (invoices write values before labels), so the page reads as noise.
- **Treat a multi-page TIFF as one part with all pages concatenated.** Rejected: it breaks laziness and the page-budget use case that `convertPages()` exists for.

## Trade-offs and consequences

- OFD reading order is a heuristic. Multi-column layouts may interleave columns, the same limitation as OCR line output.
- OFD images in JBIG2 or other formats sharp cannot decode produce a warning on that page.
- The `convertPages()` contract widens: PDF, OFD, and multi-page TIFF are paged. Everything else still yields one part.
