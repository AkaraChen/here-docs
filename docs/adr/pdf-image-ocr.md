# ADR: OCR of images on PDF text pages

## Status

Accepted

## Context and forces

- light-ocr OCRs PDF pages by rendering them (PDFium). It returns each line with a box in rendered pixels and the render transform (crop box, rotation, scale), but it does not expose rendered or decoded images.
- pdf-inspector's positioned items include image placements as boxes in PDF points, but not their pixels.
- here-docs has no PDF image decoder and does not add one: decoding every filter and color space is what unpdf builds on pdf.js for.

## Decision

- For each extracted page with an image of at least 72 × 24 pt, OCR the whole page once with light-ocr, through the same `recognizeDocumentPages` path as page OCR (one page per request, DPI fallback, inference retry).
- Map each OCR line's box into PDF points with the render transform. Keep the line when its center lies inside an image and less than 30% of it overlaps a native text run. The rest is native text that OCR read again, or text outside any image.
- Join each image's lines like any OCR text and insert them as a block after the block that holds the nearest text run above the image (preferring runs that overlap the image horizontally). The run is located in the Markdown by its text, else its last four words. Without a run above, the block goes first; if the run cannot be found, it goes last.
- Insert image text before splicing links, so link anchors are matched on the final Markdown.
- Pages with `/Rotate` are skipped: rendered pixels are rotated, and mapping them onto pdf-inspector's coordinates would rest on an unverified convention.
- The page OCR is shared with the hidden-layer check (`hidden-layer-check.md`); runs found unseen there are not treated as native text over an image.

## Considered alternatives

- Decode images from the PDF and OCR them with `recognizeEncoded`, as unpdf's `extractImages` does with pdf.js. Rejected: it needs a PDF image decoder (Flate, DCT, JBIG2, JPX, CCITT, masks, color spaces) or a second PDF engine.
- Treat any text page with an image as needing OCR. Rejected: it loses the page's structure, and logos would OCR every page of most reports.
- Append image text at the end of the page. Rejected: office documents insert at the image position, and readers expect figure text next to the figure.

## Trade-offs and consequences

- A qualifying page costs one full-page OCR (a few hundred milliseconds), at the moment the page is requested.
- A full-page background image under native text costs an OCR that finds nothing new.
- Lines are mapped by their center, so a line straddling an image edge belongs to whichever side holds its center.
- Chart axes and table pixels come out as plain lines, the same as for office documents.
