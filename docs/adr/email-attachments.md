# ADR: E-mail attachments

## Status

Accepted

## Context and forces

In office e-mail the attachment is often the actual document. The user decided that attachments are converted, not only listed (`docs/prd/format-coverage.md`). The spec keeps batch and archive conversion out of scope and requires one manuscript per call.

An attachment can be any supported format, including another e-mail with its own attachments. Converting it must reuse routing, OCR, warnings, and cancellation exactly as a top-level file would.

## Decision

- E-mail strategies (EML via `postal-mime`, MSG via `msgreader`) normalize a message into subject, addresses, date, an HTML or text body, and attachments. One renderer produces the manuscript:
  1. `# Subject`, then a list of From, To, Cc, and Date fields that are present.
  2. The body: HTML through the shared HTML converter (`cid:` images OCR'd in place), otherwise the text body.
  3. `## Attachments`, then `### <file name>` per attachment, followed by the attachment's manuscript.
- Attachments are converted by calling the same dispatcher as `convertPages()`, with the attachment's file name as the hint. When a name is missing, the MIME type supplies an extension. All of an attachment's parts are drained into its section, and the message yields one part.
- Nesting is bounded: the top-level message is depth 0, and attachments deeper than depth 3 are listed but not converted (`resource-limit` warning). The input size bounds everything else: MIME and MSG attachments are not compressed, so an attachment cannot be larger than the message that carries it.
- Attachment warnings keep their codes. Their messages are prefixed with the attachment's name.
- Inline images referenced by the HTML body are OCR'd in place and omitted from the attachment list. Inline images the body does not reference are treated as attachments. Signature parts (`application/pkcs7-signature`, `application/pgp-signature`) are omitted, so a signed message does not warn about an unreadable attachment.
- MHTML shares the HTML path but is not an e-mail: it has no header block or attachment list, and its stored resources are used only to resolve images.
- `message/rfc822` parts are always treated as attachments (`forceRfc822Attachments`), so forwarded mail is rendered by this library rather than flattened by the parser.
- Outlook stores a clear-signed S/MIME mail as an `smime.p7m` attachment that holds the whole MIME body. Its body and attachments replace the placeholder body. Opaque-signed or encrypted `.p7m` files (binary) stay attachments, since decryption is out of scope.
- Headers folded without the leading whitespace RFC 5322 requires (seen from some mail gateways) would end the header block early. A line in the header block that starts with an encoded-word is re-indented before parsing.

## Considered alternatives

- **List attachment names only.** Rejected by the user: the content is the point.
- **Yield attachments as separate parts.** Rejected: parts are pages of one document (`page`/`pageCount`), and attachments have no page numbers.
- **Unbounded recursion.** Rejected: a crafted chain of attached messages would recurse without limit.
- **Demote attachment headings under `###`.** Rejected for now: it rewrites the attachment's manuscript, and a heading with the file name already marks the boundary.

## Trade-offs and consequences

- A message with large attachments takes as long as converting each of them. Cancellation applies inside attachments, because they run through the same generator with the same signal.
- Attachment manuscripts keep their own heading levels, so an attached DOCX's `#` headings appear below the `###` file-name heading.
- Archives attached to a message (`.zip`) are listed with an `unknown-type` warning, which keeps the archive non-goal.
