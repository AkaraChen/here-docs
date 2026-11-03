# ADR: Real-engine PDF fixtures

## Status

Accepted

## Context and forces

PDF routing is the part of `here-docs` that depends most on what the native engines actually decide: which document type pdf-inspector reports, which pages it flags for OCR, what its per-page Markdown contains, and what light-ocr reads from a rendered page. Strategy tests inject fake ports, so they pin here-docs' own logic but take the engines' answers as given. The only real PDF in the repository was the one-line smoke document.

Running pdf-inspector on small handcrafted PDFs (the approach unpdf takes for pdf.js) showed answers the fakes never modeled:

- The document-level classifier lists every page of an image-based document, while the page-level extractor clears pages that have a little text. The two disagree in both directions: a short title page next to scans, and a scan with a small visible stamp.
- A text page with too few text-showing operators next to an image makes the whole document image-based.
- Link annotations, hidden optional content, and blank pages each produce output the product contract does not describe.

## Decision

- `scripts/generate-pdf-fixtures.js` writes small PDFs to `test/fixtures/pdf/`, one routing edge case per file, with known content. The only raster text is the HELLO image from `scripts/fixtures/hello.png`, so HELLO in a part means OCR read that page. The generated files are committed.
- `test/pdf-engines.test.ts` converts each fixture with `createEngine()` and asserts the observable result per page. Under `CI` a missing native engine fails the run; locally those tests skip.
- Known gaps are written as `todo` tests that assert the intended behavior. They report without failing the suite; the change that closes a gap removes its `todo`.

## Considered alternatives

- Fakes only. Rejected: they cannot catch a disagreement between the engines and here-docs' assumptions about them.
- Real-world PDFs from the web. Rejected: licensing, size, and unknown ground truth make exact assertions impossible.
- Generating fixtures at test time. Rejected: the generator uses sharp to read the PNG, and committed bytes keep every CI host on identical inputs.

## Trade-offs and consequences

- Each fixture needs enough text to look like a real page to the classifier (for example at least ten text-showing operators on a page with an image); a too-small fixture tests the classifier's thresholds instead of routing.
- The suite runs real OCR, a few seconds in total, on every CI host.
- Upgrading pdf-inspector or light-ocr is checked against these fixtures; a changed engine answer shows up as a failing or newly passing test.
- Fixture PDFs are byte-exact. `.gitattributes` marks `*.pdf` as binary: a PDF without NUL bytes would otherwise be treated as text, Windows checkouts would convert its line endings, and its cross-reference offsets would break.
