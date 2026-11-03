import assert from "node:assert/strict";
import { test } from "node:test";
import iconv from "iconv-lite";
import { convert } from "../src/convert.js";
import { htmlToDocument } from "../src/html/to-document.js";
import { documentToMarkdown } from "../src/markdown/from-document.js";
import { fakeDeps, labelledPng, labelOcr } from "./helpers.js";

function md(html: string): string {
  return documentToMarkdown(htmlToDocument(html), new Map());
}

test("structure: headings, paragraphs, emphasis, links, code", () => {
  const out = md(`<html><head><title>T</title><style>p{color:red}</style><script>alert(1)</script></head><body>
    <!-- comment --><h1>Title</h1>
    <p>Some <b>bold</b>, <em>italic</em>, <del>gone</del> and <code>x()</code> with <a href="https://example.com/a b">a link</a>.</p>
    <h2>Sub<br>title</h2>
    <pre><code class="language-python">print("hi")
</code></pre>
    <blockquote><p>Quoted</p></blockquote><hr></body></html>`);
  assert.equal(
    out,
    [
      "# Title",
      "",
      "Some **bold**, *italic*, ~~gone~~ and `x()` with [a link](https://example.com/a%20b).",
      "",
      "## Sub title",
      "",
      "```python",
      'print("hi")',
      "```",
      "",
      "> Quoted",
      "",
      "---",
      "",
    ].join("\n"),
  );
});

test("lists keep nesting, order, start, and task state", () => {
  const out = md(`<ul><li>one</li><li>two<ol start="3"><li>three</li><li>four</li></ol></li></ul>
    <ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>`);
  assert.match(out, /^- one\n- two\n\n {2}3\. three\n {2}4\. four/m);
  assert.match(out, /- \[x\] done\n- \[ \] todo/);
});

test("data tables become Markdown tables with headers and spans", () => {
  const out = md(`<table><thead><tr><th>Name</th><th>Qty</th></tr></thead>
    <tbody><tr><td>Widgets</td><td>2</td></tr><tr><td colspan="2">Total | 2</td></tr></tbody></table>`);
  assert.equal(out, "| Name | Qty |\n| --- | --- |\n| Widgets | 2 |\n| Total \\| 2 |  |\n");
});

test("layout tables render their content, not a table", () => {
  const out = md(`<table role="presentation"><tr><td><p>Hello</p></td><td><p>World</p></td></tr></table>
    <table><tr><td><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></td></tr><tr><td>after</td></tr></table>`);
  assert.ok(out.startsWith("Hello\n\nWorld\n\n"));
  assert.match(out, /\| a \| b \|/);
  assert.match(out, /after/);
  assert.ok(!out.includes("| Hello"));
});

test("images: embedded ones become assets, external ones need alt text, pixels are dropped", () => {
  const document = htmlToDocument(`<p>
    <img src="data:image/png;base64,${Buffer.from(labelledPng("EMBEDDED")).toString("base64")}" alt="fig">
    <img src="https://example.com/logo.png" alt="Logo">
    <img src="https://track.example/p.gif">
    <img src="https://track.example/p2.gif" width="1" height="1" alt="x">
    <img src="local/pic.png" alt="local pic"></p>`);
  assert.equal(document.assets.length, 1);
  assert.equal(document.assets[0]?.mediaType, "image/png");
  const out = documentToMarkdown(document, new Map([[0, "OCR TEXT"]]));
  assert.equal(out, "OCR TEXT ![Logo](https://example.com/logo.png) local pic\n");
});

test("convert routes HTML and OCRs embedded images in place", async () => {
  const html = `<!doctype html><html><head><meta charset="gbk"></head><body><p>前 <img src="data:image/png;base64,${Buffer.from(labelledPng("IMG")).toString("base64")}"> 后</p></body></html>`;
  const ocr = labelOcr();
  const result = await convert(iconv.encode(html, "gbk"), { engine: fakeDeps({ ocr }) });
  assert.equal(result.markdown, "前 IMG 后\n");
  assert.deepEqual(result.warnings, []);
});

test("a page with <main> converts only its main content; navigation is dropped", () => {
  const out = md(`<body><header><nav><a href="/">Home</a></nav><p>Site banner</p></header>
    <main><h1>Article</h1><nav role="navigation"><ul><li>TOC</li></ul></nav><p>Body text.</p>
    <span aria-hidden="true">icon</span></main><footer>Footer links</footer></body>`);
  assert.equal(out, "# Article\n\nBody text.\n");
  assert.equal(md(`<body><nav>Menu</nav><p>Mail body</p></body>`), "Mail body\n");
});

test("code languages come from common highlighter class names", () => {
  assert.match(md(`<pre class="brush: html notranslate">&lt;p&gt;</pre>`), /^```html\n<p>\n```/);
  assert.match(md(`<div class="highlight highlight-source-python"><pre>x = 1</pre></div>`), /^```python\n/);
  assert.match(md(`<pre data-lang="sql">select 1</pre>`), /^```sql\n/);
});
