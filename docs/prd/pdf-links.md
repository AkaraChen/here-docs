# PDF links

## Problem and context

A PDF's hyperlinks live in link annotations: rectangles on the page with a target URL, separate from the text drawn under them. pdf-inspector's page Markdown keeps the text but drops the targets, so "see the documentation" arrived without the URL. Office documents already keep their links through anydoc's document model, so PDFs were the odd one out. pdf-inspector does report each annotation's rectangle and URL, and every text run's position, through its positioned-items API.

## Target users and stories

- A developer converting a born-digital PDF gets the links a reader could click, as Markdown links on the same words.
- A developer feeding the Markdown to an LLM or an index keeps the URLs a citation or a reference list points to.

## Goals

- On extracted (text) PDF pages, a link annotation with a web or mail target becomes a Markdown link on the text it covers.
- A link whose text cannot be found in the page's Markdown is still kept, as an autolink at the end of the page.
- Link targets that are not web or mail addresses never become Markdown links.

## Non-goals

- Internal links (jumps to a page or a named destination) and links on OCR'd pages.
- Links on the whole-document fallback used when page extraction is unavailable.
- Link titles, tooltips, and other annotation types.

## Scope and user flow

1. A text page is extracted as before.
2. Its link annotations are read with the text runs under them.
3. Each `http`, `https`, or `mailto` link is wrapped around the words it covers, in reading order.
4. A link whose URL the Markdown already has (the extractor links visible URLs) is left as it is.
5. A link whose words cannot be found in the Markdown is appended to the page as `<url>`.

## User-visible states and failure behavior

- A page with no link annotations is unchanged.
- `javascript:`, `file:`, `data:`, and other targets stay plain text.
- If link annotations cannot be read for a batch of pages, those pages keep their text without links. This is not a warning: the page's text is complete.
- Characters that would end a Markdown link destination (spaces, `<`, `>`, `(`, `)`) are percent-encoded.

## Minimum acceptance criteria

- A sentence with a link annotation over "here-docs repository" yields `[here-docs repository](https://…)` in place.
- A `mailto:` link yields a Markdown link to the `mailto:` URL.
- A `javascript:` link and an internal jump leave the sentence plain.
- A link whose URL is already in the Markdown is not linked twice.
- A link whose anchor text is not in the Markdown appears once as `<url>` at the end of the page.

## Exclusions and resolved product decisions

- Allowed schemes are `http`, `https`, and `mailto`. Anything else is dropped because the Markdown may be rendered.
- Unplaced links are appended instead of dropped, so a URL is never silently lost.
- Anchors are snapped to whole words, and sentence punctuation around them is left outside the link.
