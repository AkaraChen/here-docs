# Format coverage

## Problem and context

`here-docs` aims to be the one local converter that turns whatever an office worker or a publishing professional receives into Markdown. v1 covered Office, OpenDocument, RTF, EPUB, CSV, PDF, and common raster images. The files those users actually exchange also include web pages, e-mail, plain text in legacy encodings, multi-page scans, iPhone photos, and, in China, OFD e-invoices and government documents. Each gap today ends in empty Markdown with an `unknown-type` warning, or in mojibake.

Supporting every format that exists is not the goal. Coverage is chosen for roughly 80% of what a typical practitioner meets, at a fraction of the cost of chasing every proprietary format.

## Target users and stories

- An office worker converts a forwarded `.eml` or Outlook `.msg` and gets the headers, the body, and the content of its attachments in one manuscript.
- A publishing editor converts a web-novel `.txt` saved in GBK, a Markdown manuscript, or a multi-page TIFF scan of an old edition.
- A finance or government user in China converts an OFD e-invoice or official document.
- A user converts a saved web page (`.html`, `.mht`) or a photo taken on an iPhone (`.heic`).
- A data professional converts a Jupyter notebook, including the tables pandas renders as HTML.

## Goals

- Add the in-scope formats below with the same contract as v1: bytes in, `{ markdown, warnings }` out, best-effort, local only.
- Convert e-mail attachments through the same pipeline, inline in the message's manuscript.
- Read legacy text encodings (GBK/GB18030, Big5, Shift_JIS, EUC-KR, Windows code pages, UTF-16) for text and CSV inputs.
- Keep one Markdown style across formats: structured inputs share the document model and serializer used for Office documents.

## Non-goals

These formats stay unsupported. They yield empty Markdown and an `unknown-type` or `unsupported` warning:

- Apple iWork (`.pages`, `.numbers`, `.key`): no public specification; users can export DOCX or PDF.
- Desktop publishing and typesetting formats: InDesign (`.indd`, `.idml`), FounderType/方正 formats. Their deliverable is a PDF.
- Markup languages handled by pandoc: LaTeX, reStructuredText, AsciiDoc, Org, DocBook, JATS. Without a filename hint or markers, they fall back to plain text.
- Regional or proprietary office formats: HWP/HWPX, Ichitaro, CAJ, XPS/OXPS, Visio, OneNote, Publisher, Project, Flat ODF, StarOffice, Word 2003 XML, and Microsoft Works (whose `.wps` extension collides with Kingsoft WPS; Works files end with a `missing-part` warning).
- E-book formats other than EPUB: MOBI/AZW, DjVu, FB2, CBZ.
- Archives and mailboxes (`.zip`, `.rar`, `.7z`, `.mbox`): batch containers stay out of scope. An archive attached to an e-mail is listed with a warning, not opened.
- Rendering vector images that are not SVG (EMF/WMF) embedded in Office documents. They stay skipped assets with a warning.
- Audio, video, and decryption, as before.

## Scope and user flow

The flow is unchanged: the caller passes bytes, an engine, and an optional filename hint, and receives one manuscript. New inputs:

| Input | Result |
| --- | --- |
| Office and OpenDocument templates (`.dotx`, `.dotm`, `.dot`, `.xltx`, `.xltm`, `.xlt`, `.potx`, `.potm`, `.ott`, `.ots`, `.otp`) | Same as the matching document format |
| Kingsoft WPS binaries (`.wps`, `.wpt`, `.et`, `.ett`, `.dps`, `.dpt`) | Same as Word, Excel, or PowerPoint binaries (they share those containers) |
| TSV | A table, like CSV |
| CSV and TSV in a legacy encoding | Decoded to Unicode before conversion |
| Plain text (`.txt`) and Markdown (`.md`) | The decoded text, unchanged apart from line endings |
| HTML and XHTML | Structured Markdown: headings, paragraphs, lists, tables, quotes, code, links. Embedded (`data:`) images are OCR'd in place |
| E-mail (`.eml`, Outlook `.msg`) | Subject heading, sender/recipient/date fields, body, then each attachment converted under its own heading |
| Web archives (`.mht`, `.mhtml`) | The archived page as HTML. Images stored in the archive are OCR'd in place |
| OFD | One part per page. Text pages produce their text in reading order; image-only pages are OCR'd |
| Jupyter notebooks (`.ipynb`) | Markdown cells as written, code cells as fenced code, outputs as text, tables, or OCR text |
| Multi-page TIFF | One part per page, each OCR'd |
| HEIC/HEIF photos | Decoded locally (the primary image of grids and bursts), then OCR'd |
| BMP images | Decoded locally, then OCR'd. Older Outlook mail embeds signatures and screenshots as BMP |
| AVIF images | Decoded to a raster, then OCR'd |
| SVG images, standalone or embedded in Office documents and HTML | The text the drawing contains (including Mermaid and draw.io labels); drawings without text are rendered and OCR'd |

Detection still prefers content. Formats without a binary signature (HTML, e-mail, notebooks, SVG, plain text) are recognized from their content when no filename hint names them. Text that matches nothing richer is converted as plain text. HTML or tab-separated text saved under an Office name (`export.xls`, `report.wps`, as business systems often produce) converts by its content: HTML as HTML, delimited text with a spreadsheet name as a table.

## User-visible states and failure behavior

- An attachment that cannot be converted keeps its heading in the manuscript. Its warnings are added to the message's warnings with the attachment named in the message.
- Attachments nested deeper than three levels (an e-mail attached to an e-mail attached to an e-mail) are listed but not converted, with a `resource-limit` warning.
- An OFD page whose image cannot be decoded (for example JBIG2) yields an empty page and a warning. Other pages still convert.
- A TIFF page that fails to decode or OCR yields that page empty with a warning. Other pages still convert.
- An HEIC image that neither decoder can read yields a `transcode-failed` warning.
- Bytes that decode as text but whose encoding cannot be determined reliably are still converted as text. Bytes that do not look like text and match no format remain `unknown-type`.
- A malformed HTML, e-mail, notebook, or OFD file yields whatever could be read, or empty Markdown with a `malformed` warning. It never throws.

## Minimum acceptance criteria

- A `.dotx` and a `.ott` convert like `.docx` and `.odt`.
- An HTML export named `.xls` or `.wps` converts as HTML, and a tab-separated export named `.xls` converts as a table.
- A GBK-encoded CSV converts to a table with correct Chinese text. A GBK `.txt` converts to correct Chinese text.
- UTF-8 text without a filename hint converts as plain text instead of `unknown-type`. Random binary bytes still return `unknown-type`.
- An HTML file converts headings, lists, a data table, links, and emphasis to Markdown. Scripts, styles, and comments are dropped. Layout tables (single column, nested tables, or `role="presentation"`) do not become Markdown tables.
- An `.eml` with an HTML body, an inline `cid:` image, and a PDF attachment yields: the subject, the header fields, the body with the image's OCR text in place, and the PDF's text under the attachment's name.
- An Outlook `.msg` yields its subject, sender, recipients, body, and converted attachments, including an embedded `.msg`.
- An `.mhtml` page converts its HTML, and images stored in the archive are OCR'd in place.
- An OFD e-invoice yields its labels and values (including those on the template page) in reading order, one part per page.
- A notebook yields markdown cells, fenced code cells with the kernel language, and stream and table outputs.
- A three-page TIFF yields three parts with `page` 1..3 and `pageCount` 3.
- An iPhone HEIC photo converts through OCR on every supported host.
- Every format above completes without throwing on malformed input.
- `npm run corpus` passes: several hundred public real-world files (e-mail from many mail clients and charsets, Outlook messages with legacy code pages, OFD invoices and official documents, legacy-encoded text and CSV, web pages, notebooks, TIFF scans and faxes, HEIC/AVIF photos, SVG diagrams, Office templates, and Kingsoft WPS files) convert with their expected text and without unexpected warnings.

## Known limitations

Found by the real-world corpus (`npm run corpus`); none of them throws, and each ends in less text or a warning:

- anydoc does not return text from OpenDocument text boxes, legacy Word headers, footers, and shape text boxes, or DOCX images stored only as SVG (without a PNG fallback). Its OLE reader rejects some non-standard writers (an Aspose-written `.pot`).
- OFD pages whose text is drawn as vector paths have no extractable text, and there is no local OFD renderer to OCR them. Multi-column OFD layouts interleave columns line by line.
- AVIF files that use layered coding, image sequences, or more grid tiles than libheif's security limit, and HEIF files whose image is JPEG-coded, cannot be decoded.
- TIFF pages compressed with JBIG or PixarLog cannot be decoded.
- Very short legacy-encoded text in a non-CJK script (one Cyrillic or Central European line) can still be decoded with the wrong code page; HZ and UTF-7 are not supported.
- OCR quality bounds image text: stylized logos and low-contrast photos may come back partial.

## Exclusions and resolved product decisions

- E-mail attachments are converted, not only listed (decided with the user). Inline images that the HTML body references are OCR'd in place and are not repeated as attachments.
- Plain text and Markdown are passed through unescaped. A text file's manuscript is its text.
- The CSV filename-hint rule changes: CSV without a hint is no longer `unknown-type`. It is converted as plain text, so the content is kept even when its table structure is not recovered.
- A saved web page that marks its main content (`<main>`) converts only that content: menus, sidebars, and footers are site chrome. Navigation is dropped everywhere.
- External images in HTML (`http(s)` URLs) are not fetched. An external image with alt text renders as a Markdown image; without alt text it is dropped, which removes tracking pixels from e-mail.
- OFD text is placed by position on the page and is not Markdown-escaped, the same as OCR text.
