# Hidden PDF layers

## Problem and context

A PDF can put content in layers (optional content groups) and turn some off in its default configuration: draft notes, alternate-language text, print-only or screen-only variants. A viewer does not show them. pdf-inspector extracts their text anyway (checked in 1.14.2 and 1.25.2), so a text page's Markdown could contain words the reader never sees. OCR'd pages were already correct, because the renderer honors layer visibility.

## Target users and stories

- A developer converting a layered PDF (a form with draft notes, a map, a CAD export) gets the text a viewer shows, not the hidden layers.
- A developer converting an ordinary PDF pays nothing for this.

## Goals

- On extracted pages of a document that hides layers by default, text the rendered page does not show is left out.
- Text in layers that are shown stays.
- Documents without hidden layers are not OCR'd or slowed down.

## Non-goals

- A general visibility filter for text hidden by other means (white on white, clipped away, behind images) in documents without hidden layers.
- Honoring layer visibility on the whole-document fallback used when page extraction is unavailable.
- Choosing a non-default layer configuration.

## Scope and user flow

1. Before extracting text pages, the document's bytes are checked for optional content turned off by default. The check also covers catalogs inside compressed object streams.
2. If there is none, extraction is unchanged.
3. If there is, each text page is OCR'd once with the bundled OCR engine when it is requested, and the text runs no recognized line touches are removed from the page's Markdown. If the page also has pictures of text, the same OCR serves both.
4. Removed runs are also excluded from link and image-text placement.

## User-visible states and failure behavior

- A page whose layer check cannot run (OCR fails) keeps its extracted text and gets a `pdf-layer-check-failed` warning.
- Text is removed only when the check can judge it. Runs smaller than 8 pt, runs with fewer than three letters or digits, and runs outside the page are kept. Rotated pages and pages where OCR recognized nothing are not checked.
- When most of a page's checked runs look unseen, the page's positions and rendering disagree, and nothing is removed.
- A hidden layer drawn at the same position as visible text (for example a translation overlaid on the original) is not detected and its text stays.

## Minimum acceptance criteria

- In a document with a layer that is off by default and one that is on, a text page keeps the visible prose and the shown layer's text and drops the hidden layer's text.
- A document without hidden layers is not OCR'd for this check.
- A failed check keeps the page text with a `pdf-layer-check-failed` warning.
- On ordinary text PDFs checked as if they hid layers, no visible text is removed.

## Exclusions and resolved product decisions

- Visibility is judged by the bundled OCR engine reading the rendered page. here-docs does not parse layer structure itself.
- When unsure, keep the text: wrongly dropping visible text is worse than keeping hidden text.
- The part's `source` stays `text`: the check removes text, it adds none.
