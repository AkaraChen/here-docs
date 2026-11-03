# ADR: PDF link splice

## Status

Accepted

## Context and forces

pdf-inspector (1.14.2 and 1.25.2) renders page Markdown without link targets. Its `extractTextWithPositions(buffer, pages)` reports text runs and link annotations with their boxes in PDF points (origin bottom-left), and link items carry `linkUrl`. Text runs are whole `Tj` runs, often a full line, so a link that covers part of a line has no run of its own. The positioned-items API is synchronous, takes 1-based page numbers, and costs roughly in proportion to the pages requested (about 0.5 s for 64 pages of a 269-page document).

## Decision

- `PdfInspectorPort` gains an optional `pageItems(bytes, pages)` that returns text, link, and image items for 0-based pages. The adapter maps it onto `extractTextWithPositions`.
- The PDF strategy reads items for text pages only, at most 64 pages at a time: once per lazy extraction batch, or per 64-page chunk when `convert()` extracts everything at once.
- `spliceLinks` (in `src/markdown/`) works on one page:
  - Links with a safe scheme (`http`, `https`, `mailto`) are taken in reading order.
  - The anchor is the words of the text runs under the link's rectangle. Character positions inside a run are estimated from proportional advance widths (Helvetica metrics, one em per CJK character), and the anchor is snapped to whole words.
  - The anchor is searched in the page Markdown. Whitespace, Markdown escapes, emphasis markers, and inline HTML may differ. Latin anchors must match on word boundaries. The first match after the previous link wins, and matches inside existing links or ones that would split an HTML tag are skipped.
  - Links already in the Markdown are left alone. Unplaced links are appended as autolinks.
- Failure to read items is swallowed: links are enrichment on top of complete text.

## Considered alternatives

- Wait for pdf-inspector to emit links in its Markdown. Rejected for now: no released version does (checked through 1.25.2), and the request is open upstream as firecrawl/pdf-inspector#545. This splice can go once it ships.
- A list of links at the end of each page. Rejected: it loses which words were linked, which is the information a reader uses.
- Exact glyph positions. Rejected: the API reports runs, not glyphs. Width estimates are good enough once snapped to words.

## Trade-offs and consequences

- The synchronous items call blocks the event loop for each batch of text pages, in proportion to the batch size.
- An anchor rewritten by the extractor (a table cell, a merged run) may not be found. Its URL is then appended instead of linked in place.
- The scheme allowlist is a safety boundary: the output is Markdown that callers may render.
