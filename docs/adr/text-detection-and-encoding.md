# ADR: Text detection and encoding

## Status

Accepted

## Context and forces

v1 detected formats by binary signature (images, PDF, ZIP and OLE packages through anydoc) and fell back to a filename hint for CSV. The new formats in `docs/prd/format-coverage.md` include several with no binary signature: HTML, e-mail, MHTML, notebooks, SVG, Markdown, and plain text. Users often pipe them through stdin without a name.

Text in the target markets is frequently not UTF-8: Chinese web novels and CSV exports from Chinese Excel are GBK/GB18030, Japanese files are Shift_JIS, and Windows tools write UTF-16 with a BOM. anydoc reads CSV bytes as UTF-8 or Latin-1, so a GBK CSV becomes mojibake.

## Decision

Detection runs in this order. The first match wins:

1. **Binary signatures**: image magic (including AVIF and HEIC `ftyp` brands), `%PDF`, then anydoc's package detection (OLE stream names, ZIP mimetype and content types). ZIP packages containing `OFD.xml` are OFD. OLE files with MAPI property streams (`__substg1.0_`) are Outlook messages.
2. **Filename hint**: the extension names the format. This covers CSV/TSV, which have no reliable content marker, and lets a caller force `.txt` on a file that happens to start with `<html>`. A hint for a format that always has a binary signature (PDF, OFD, Office binaries and packages, raster images, MSG) cannot be right when step 1 found no signature. If the bytes are text, steps 3–4 decide instead, and plain text named like a spreadsheet (`.xls`, `.xlsx`, `.et`, `.ods`) is read as delimited data. Business systems routinely export HTML or TSV under Office names. Binary bytes keep the hinted route, so a corrupt file still gets the parser's `malformed` warning.
3. **Text sniffing** on a decoded prefix: an HTML doctype or `<html>` root, an SVG root, a MIME header block (`multipart/related` with a snapshot location, or no addressee, means MHTML; otherwise e-mail), or a JSON object with `nbformat` and `cells`.
4. **Plain-text fallback**: bytes that decode as text become plain text. Bytes with NULs or a high share of control characters stay `unknown`.

Decoding is shared by detection, text, CSV, HTML, and MIME parts:

- A BOM wins (UTF-8, UTF-16LE, UTF-16BE). Without one, UTF-16 is recognized when NUL bytes fall lopsidedly on one side of the code units and the decoded text has no control characters.
- ISO-2022-JP is 7-bit, so it also passes as UTF-8: its `ESC $ B` / `ESC $ @` shifts are checked first. iconv-lite lacks it; the runtime's `TextDecoder` (Node and Bun both have it) decodes it.
- Strict UTF-8 is tried next. Valid UTF-8 beats a declared charset: pages and mails that declare GBK or Latin-1 but carry UTF-8 are a common misconfiguration, while legacy text that happens to form valid UTF-8 is rare.
- A declared charset (HTML `<meta charset>` within the first 64 KiB, MIME `charset=`) is used next if it is known. As in the WHATWG Encoding Standard, legacy labels decode with the superset producers actually write: GB18030 for GB2312/GBK, Windows-31J for Shift_JIS, UHC for EUC-KR, Big5-HKSCS for Big5.
- Otherwise a statistical detector (`chardet`) picks the encoding and `iconv-lite` decodes it. Both are pure JavaScript, so decoding does not depend on the runtime's ICU build (Bun included). For HTML without a declaration, detection runs on the text with its markup removed, since tags and scripts are ASCII and drown the statistics.
- Short inputs (a two-line CSV) leave the detector guessing: GB18030, Big5, Shift_JIS, EUC-JP, and EUC-KR tie, or a single-byte code page wins on a few bytes. Unless the detector is confident, each CJK decoding is scored by the share of common characters (frequent Chinese and Korean characters, kana). A decoding that is mostly common characters wins, provided the high bytes come in pairs as double-byte encodings write them: a lone Latin-1 accent followed by ASCII (`é_`) can also spell a common CJK character.

Mail adds two cases the parsers do not cover:

- Header values written as raw 8-bit bytes (no RFC 2047 encoded-words, common in Korean, Russian, and Chinese mail) arrive from the MIME parser as Latin-1. They are re-decoded: UTF-8 if valid, else the charset the message declares for its parts, else detection. A body without a charset that carries ISO-2022-JP escape sequences is decoded as ISO-2022-JP.
- Outlook MSG stores non-Unicode string properties in the sender's Windows code page. They are decoded with the message code page, or the Windows code page its internet code page implies (50220 ISO-2022-JP → 932, 20866 KOI8-R → 1251, and so on).

CSV and TSV bytes that are not UTF-8 are re-encoded to UTF-8 before anydoc parses them. TSV goes to anydoc's CSV parser, which detects the delimiter.

## Considered alternatives

- **Hints before signatures.** Rejected: a misnamed PDF or DOCX would be misrouted. Binary signatures are unambiguous.
- **Sniffing before hints.** Rejected: weak text markers would override the caller's explicit intent (a `.txt` of HTML source).
- **Keep `unknown-type` for unhinted text.** Rejected: a universal converter that drops readable text is worse than one that returns it unformatted.
- **`TextDecoder` with ICU labels only.** Rejected: there is no detection, and Bun and small-ICU builds lack many legacy decoders.

## Trade-offs and consequences

- CSV without a hint now becomes plain text instead of `unknown-type`. The contract's "CSV needs a hint" rule becomes "CSV needs a hint to become a table".
- Statistical detection can still guess wrong on very short non-CJK legacy inputs (a Cyrillic or Central European sentence). A BOM, a declared charset, or valid UTF-8 always takes precedence, so the common cases are deterministic.
- Detection decodes at most a 64 KiB prefix, so sniffing cost does not grow with file size.
