# ADR: Pure-JavaScript format parsers

## Status

Accepted

## Context and forces

The formats added in `docs/prd/format-coverage.md` (HTML, e-mail, MHTML, Outlook MSG, OFD, notebooks, legacy text encodings, HEIC) are not handled by the three native engines. Every native addon multiplies the platform matrix in `docs/adr/native-platform-packages.md`: one optional package per OS, CPU, and libc, a resolve hook, and a CI job per host.

The Office path already owns a Markdown serializer for anydoc's document model (`docs/adr/document-model-splice.md`). That serializer places OCR text at each image's position.

## Decision

- New formats are parsed in JavaScript, with no new native addons:
  - `htmlparser2`: HTML, and XML for OFD.
  - `postal-mime`: e-mail (RFC 822/MIME).
  - `@kenjiuno/msgreader` and `rtf-stream-parser`: Outlook MSG and the HTML encapsulated in its compressed RTF body.
  - `fflate`: OFD ZIP packages.
  - `chardet` and `iconv-lite`: encodings.
  - `libheif-js`: HEVC-coded HEIC.
- MHTML uses a small in-house `multipart/related` reader, because `postal-mime` does not expose each part's `Content-Location`, which is how archived pages reference their images.
- HTML (from files, e-mail bodies, MHTML, and notebook outputs) is converted into anydoc's document model and rendered by the existing serializer. Embedded images become document assets and go through the same OCR splice as Office images. Formats that are Markdown already (notebook markdown cells, plain text) are passed through.
- sharp's bundled libheif decodes only AV1 (AVIF), so iPhone HEIC photos fail there. The image adapter falls back to `libheif-js` (libheif compiled to WebAssembly) when sharp cannot read a HEIC input, and decodes the file's primary image: grids, overlays, and bursts list tiles or frames first. The decoder is imported only on that path.
- SVG text is read from the markup, not rasterized: `<text>` elements and the HTML labels Mermaid and draw.io put in `foreignObject` are exact and do not depend on installed fonts (rasterizing dropped CJK text and every `foreignObject` label). `systemLanguage` variants are read as an English-language renderer shows them, so output does not depend on the machine's locale. Only drawings without text (text outlined as paths) are rendered by sharp and OCR'd.
- Images reach the OCR engine opaque and within its limits: it reads transparent pixels as black, so transparency is flattened onto white, or onto black when the visible content is light. Images above about 40 Mi pixels or 10k pixels per side are rejected by the engine, so they are shrunk and retried.
- All dependencies are pinned to exact versions, like the engines.

## Considered alternatives

- **pandoc or LibreOffice as an external process.** Rejected: not local-install-only, large, and outside the npm platform model.
- **Native HTML or e-mail addons.** Rejected: they add platform packages for formats where JavaScript is fast enough.
- **A separate Markdown renderer per format.** Rejected: headings, tables, and emphasis would drift between formats, and image OCR placement would be reimplemented each time.
- **Skip HEIC.** Rejected: iPhone photos of documents are a common office input, and the spec already promised them.

## Trade-offs and consequences

- `libheif-js` is LGPL-3.0. It is an unmodified npm dependency loaded at runtime, not bundled into `here-docs`, so the package stays MIT and users can replace the library. It adds about 9 MB on disk, and the WebAssembly decoder is slower than native.
- The JavaScript parsers run on the main thread. Large HTML or e-mail inputs block the event loop for the parse, unlike the native engines, which run on the libuv pool.
- The platform matrix and the native resolve hook are unchanged. Bun loads every new dependency as plain JavaScript.
