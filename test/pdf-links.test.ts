import assert from "node:assert/strict";
import { test } from "node:test";
import { spliceLinks } from "../src/markdown/pdf-links.js";
import type { PdfPageItem } from "../src/types.js";

/** A 12pt text run at `y`, `width` points wide, and a link rectangle over `[from, to]` of it. */
function text(value: string, y: number, width: number, x = 30): PdfPageItem {
  return { page: 0, kind: "text", text: value, x, y, width, height: 12 };
}

function link(url: string, x: number, y: number, width: number): PdfPageItem {
  return { page: 0, kind: "link", text: url, x, y: y - 3, width, height: 14, url };
}

// "Read the here-docs repository for the details." in 12pt Helvetica starts at x=30; the anchor spans 82..191.4.
const sentence = text("Read the here-docs repository for the details.", 180, 240.1);
const repo = "https://github.com/AkaraChen/here-docs";

test("wraps the text under a link annotation in place", () => {
  const markdown = "Read the here-docs repository for the details.";
  assert.equal(
    spliceLinks(markdown, [sentence, link(repo, 82, 180, 109.4)]),
    `Read the [here-docs repository](${repo}) for the details.`,
  );
});

test("leaves unsafe link schemes as plain text", () => {
  const markdown = "Read the here-docs repository for the details.";
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "not a url"]) {
    assert.equal(spliceLinks(markdown, [sentence, link(url, 82, 180, 109.4)]), markdown);
  }
});

test("keeps links the Markdown already has", () => {
  const markdown = `Read the [here-docs repository](${repo}/) for the details.`;
  assert.equal(spliceLinks(markdown, [sentence, link(repo, 82, 180, 109.4)]), markdown);
});

test("an anchor that is the URL itself becomes an autolink", () => {
  const visible = text("See https://example.com/docs today", 100, 200);
  const markdown = "See https://example.com/docs today";
  assert.equal(
    spliceLinks(markdown, [visible, link("https://example.com/docs/", 52, 100, 120)]),
    "See <https://example.com/docs/> today",
  );
});

test("appends a link whose anchor cannot be found, so its URL is kept", () => {
  const markdown = "| a table | that the extractor rewrote |";
  assert.equal(spliceLinks(markdown, [sentence, link(repo, 82, 180, 109.4)]), `${markdown}\n\n<${repo}>`);
  assert.equal(spliceLinks("", [link(repo, 82, 180, 109.4)]), `<${repo}>`);
});

test("matches across Markdown escapes, emphasis, and inline HTML, and keeps tags nested", () => {
  const line = text("write us at feedback@example.com.", 100, 180);
  const mail = link("mailto:feedback@example.com", 92, 100, 118);
  assert.equal(
    spliceLinks("write us at <u>feedback@example.com</u>.", [line, mail]),
    "write us at <u><mailto:feedback@example.com></u>.",
  );
  // The run has the plain text; the Markdown has emphasis and an escaped underscore.
  const styled = text("the here_docs guide", 100, 108.7);
  assert.equal(
    spliceLinks("the **here\\_docs** guide", [styled, link(repo, 50, 100, 56)]),
    `the **[here\\_docs](${repo})** guide`,
  );
});

test("a repeated anchor is linked where the annotation is, in reading order", () => {
  const first = text("docs one", 200, 50);
  const second = text("docs two", 180, 50);
  const markdown = "docs one\ndocs two";
  assert.equal(
    spliceLinks(markdown, [first, second, link("https://a.example/", 30, 200, 25), link("https://b.example/", 30, 180, 25)]),
    "[docs](https://a.example/) one\n[docs](https://b.example/) two",
  );
});

test("characters that would end a Markdown destination are percent-encoded", () => {
  const markdown = "Read the here-docs repository for the details.";
  assert.equal(
    spliceLinks(markdown, [sentence, link("https://example.com/a b(c)", 82, 180, 109.4)]),
    "Read the [here-docs repository](https://example.com/a%20b%28c%29) for the details.",
  );
});
