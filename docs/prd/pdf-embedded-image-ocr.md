# OCR of images on PDF text pages

## Problem and context

A born-digital PDF often carries text only as pixels: a screenshot, a scanned figure, a chart, or a logo with words. Pages with a text layer are extracted structurally and never OCR'd, so that text was lost. Office documents already OCR their embedded images and insert the text where each image was. PDFs did not.

## Target users and stories

- A developer converting a slide deck or report exported to PDF gets the words inside its screenshots and figures, next to the surrounding text.
- A developer indexing PDFs finds a document by text that appears only in one of its images.

## Goals

- On an extracted (text) PDF page, images large enough to hold text are OCR'd with the bundled OCR engine. The recognized text is inserted where the image sits in the reading order.
- Native text drawn over an image (captions, labels) is not repeated from OCR.
- The page keeps its structured text. Image text is added, never substituted.

## Non-goals

- Describing images that hold no text (photos, diagrams without words).
- Reconstructing tables or charts from pixels. Recognized lines are inserted as plain lines.
- Images on pages that are OCR'd whole, which are already covered.
- Pages with a `/Rotate`. Their image text is skipped in this version.

## Scope and user flow

1. A text page is extracted as before.
2. Its images are read with their positions. Images smaller than 72 × 24 pt (logos, bullets, rules) are ignored.
3. If any image remains, the page is OCR'd once, when the page is requested.
4. OCR lines inside an image that do not overlap native text become that image's text.
5. Each image's text is inserted as its own block after the block holding the nearest text above the image. It goes at the start of the page when nothing is above the image, and at the end when that text cannot be found.
6. The part's `source` is `mixed` when image text was inserted, otherwise `text`.

## User-visible states and failure behavior

- A text page without qualifying images is unchanged and costs no OCR.
- If image OCR fails, the page keeps its text, `source` stays `text`, and a `pdf-image-ocr-failed` warning names the page.
- Image OCR follows the same cancellation rules as page OCR: an abort rejects instead of becoming a warning.

## Minimum acceptance criteria

- A text page with a figure whose only content is the word HELLO yields HELLO between the paragraph above and the paragraph below the figure, with `source: "mixed"`.
- A page whose only image is logo-sized is not OCR'd and stays `text`.
- A caption drawn as native text over an image appears once.
- A failed image OCR yields the page text and a `pdf-image-ocr-failed` warning.

## Exclusions and resolved product decisions

- Image text is inserted by default. There is no option to turn it off, matching office documents.
- The size threshold (72 × 24 pt) is a heuristic, recorded in `docs/adr/pdf-image-ocr.md`.
- OCR uses the bundled light-ocr engine, the same as every other OCR in here-docs.
