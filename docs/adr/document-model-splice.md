# ADR: Document-model splice

## Status

Accepted

## Context and forces

Office documents must insert OCR text at each embedded image’s original position. anydoc’s Markdown serializer emits only alt text for embedded assets (nothing when alt is empty) and keeps bytes on `Document.assets`. The Node package has `toDocument` but no `documentToMarkdown`. String replacement on `toMarkdownBytes` cannot place OCR when alt is empty or duplicated.

## Decision

Walk the anydoc `Document` model, OCR each raster asset, replace `image` inlines with the recognized text, and serialize the walked model to GitHub-Flavored Markdown in this library.

## Considered alternatives

- Replace unique alt strings in `toMarkdownBytes` output. Rejected: empty and duplicate alts lose position.
- Append an “Embedded images” section. Rejected: violates the in-place insertion contract.
- Wait for anydoc to export a serializer. Rejected: blocks v1 and still needs an insertion hook.

## Trade-offs and consequences

- This package owns a serializer for the published anydoc block/inline model. It must cover headings, paragraphs, lists, tables, quotes, code, rules, links, notes, and image inlines.
- Serializer tests compare structure and insertion position, not pixel-perfect parity with anydoc’s own Markdown for every edge case.
- Non-raster or untranscodable assets stay as alt text (or nothing) and record a warning.
