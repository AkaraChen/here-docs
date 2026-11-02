# ADR: Hidden optional content is a known limitation

## Status

Superseded by `hidden-layer-check.md`, which removes hidden-layer text by checking pages against their rendering.

## Context and forces

A PDF can put content in optional content groups (OCGs, "layers") and turn some of them off in its default configuration (`/OCProperties /D /OFF`). Viewers do not paint that content: draft notes, alternate-language text, print-only or screen-only variants.

pdf-inspector (checked in 1.14.2 and 1.25.2) has no optional content handling. Its page Markdown, plain text, and positioned items all include text from groups that are off. `test/fixtures/pdf/hidden-layer.pdf` shows the leak: "Hidden layer words" comes out as a heading on a text page. Content in a soft mask, by contrast, is correctly left out. OCR'd pages are not affected, because rendering honors the default configuration.

here-docs does not parse PDFs itself: it routes bytes between engines. Telling hidden from visible content needs the catalog's optional content configuration and each content stream's marked-content nesting, which is the extractor's job.

## Decision

- Hidden optional content on extracted pages is a documented known limitation, not a here-docs contract violation to work around.
- The intended behavior is pinned as a `todo` test on the hidden-layer fixture, so an engine upgrade that fixes it shows up as a passing test.
- The fix belongs upstream in pdf-inspector, with a repro based on the hidden-layer fixture.

## Considered alternatives

- A PDF parser in here-docs that finds groups that are off and their marked content. Rejected: compressed object streams, inherited resources, form XObjects, and OCMD visibility expressions make it a second PDF parser to maintain.
- pdf.js (for example through unpdf) to compute visibility. Rejected: a second multi-megabyte PDF engine on every conversion, used only to filter text a native engine already extracted, and there is no reliable way to map pdf.js text items back to pdf-inspector's Markdown.
- OCR every page of a document that has optional content. Rejected: it throws away structure for every layered document to hide a minority of text.

## Trade-offs and consequences

- Until the extractor honors optional content, text pages of layered PDFs may include text a reader does not see.
- When upstream fixes it, removing the `todo` from the fixture test is the only change needed here.
