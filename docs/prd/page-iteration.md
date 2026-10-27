# Page iteration and cancellation

## Problem and context

`convert()` returns one manuscript only after every page is done. A caller that needs only the first pages of a long PDF (for example a scraper with a page budget) still pays for extracting and OCR'ing the whole document, and a caller with a deadline has no way to stop a conversion that is already running. OCR of a scanned page costs hundreds of milliseconds, so a long scan can run for minutes.

Separately, whole-document OCR of a scanned PDF hit the OCR engine's per-request limits (at most 100 pages and 100 Mi rendered pixels, about 50 letter pages at the default resolution). Longer scans completed with empty Markdown and a single `ocr-failed` warning.

## Target users and stories

- A developer iterates `convertPages(bytes, { engine })` and stops after N pages. Pages after N are never extracted or OCR'd.
- A developer passes an `AbortSignal` to `convert()` or `convertPages()` and aborts it on a deadline or client disconnect. The call rejects promptly and the engine stays usable.
- A developer converts a scanned PDF of any length and gets every page.

## Goals

- A page-by-page iterator with the same routing, warnings, and best-effort rules as `convert()`.
- Laziness: work for a page happens only when the consumer asks for that page.
- Cancellation through a standard `AbortSignal` on both entry points.
- Scanned PDFs are not limited by the OCR engine's per-request page or pixel limits.

## Non-goals

- A built-in page limit option. Stopping the iterator is the page limit.
- Interrupting a native call that is already running (anydoc parsing, PDF classification, a single text extraction). Cancellation takes effect at the next check, which is at most one page or one OCR inference away.
- Per-page iteration of office documents. They have no stable page model and yield one part.

## Scope and user flow

1. The caller creates an engine.
2. The caller calls `convertPages(bytes, { engine, filename?, signal? })` and iterates it with `for await`.
3. For a PDF, each step yields `{ page, pageCount, markdown, warnings }` for the next page, in page order. Text pages come from structured extraction, pages that need OCR from OCR.
4. For other inputs, the iterator yields one part with `page: null` and `pageCount: null`.
5. Breaking out of the loop ends the conversion. No further pages are processed.
6. `convert()` is the iterator drained: non-empty parts joined by a blank line, warnings concatenated.

## User-visible states and failure behavior

- Illegal call (not bytes, no engine): `convertPages()` throws synchronously, before iteration. `convert()` rejects as before.
- A page whose OCR fails yields that page with empty Markdown and a `pdf-page-ocr-failed` warning. Later pages still come.
- Abort before or during a conversion rejects the pending step with `signal.reason`. It is never turned into a warning.
- After an abort the engine can be used for the next conversion.

## Minimum acceptance criteria

- `convertPages()` on an N-page PDF yields N parts with `page` 1..N and `pageCount` N.
- Breaking after k pages performs OCR for none of pages k+1..N and does not extract text pages far beyond k.
- `convert()` output equals the joined parts.
- An already-aborted signal rejects without doing any work; aborting mid-OCR rejects with the reason, not a warning.
- A 60-page scanned PDF converts every page.
