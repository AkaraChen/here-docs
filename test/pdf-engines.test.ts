import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { convert, convertPages, createEngine } from "../src/index.js";
import type { ConvertEngine, ConvertPart } from "../src/types.js";

// Routing against the real engines, on the handcrafted PDFs from scripts/generate-pdf-fixtures.js. Every page's
// content is known, so these tests pin which pages are extracted and which are OCR'd. The only raster text in the
// fixtures is "HELLO", so HELLO in a part means OCR read that page.

const fixtures = join(import.meta.dirname, "fixtures", "pdf");
let engine: ConvertEngine | undefined;
let unavailable: string | undefined;

before(async () => {
  try {
    engine = await createEngine();
  } catch (error) {
    if (process.env.CI) {
      throw error;
    }
    unavailable = error instanceof Error ? error.message : "native engines unavailable";
  }
});

after(async () => {
  await engine?.close();
});

async function pages(name: string, t: { skip: (message: string) => void }): Promise<ConvertPart[] | null> {
  if (!engine) {
    t.skip(unavailable ?? "native engines unavailable");
    return null;
  }
  const parts: ConvertPart[] = [];
  for await (const part of convertPages(await readFile(join(fixtures, name)), { engine, filename: name })) {
    parts.push(part);
  }
  return parts;
}

function ocrd(part: ConvertPart | undefined): boolean {
  return part?.source === "ocr";
}

test("a text PDF keeps every page structured and runs no OCR", async (t) => {
  const parts = await pages("text.pdf", t);
  if (!parts) return;
  assert.deepEqual(
    parts.map((part) => [part.page, part.pageCount, ocrd(part)]),
    [
      [1, 2, false],
      [2, 2, false],
    ],
  );
  assert.match(parts[0]!.markdown, /Alpha digital page/);
  assert.match(parts[1]!.markdown, /Beta digital page/);
});

test("a scanned PDF is OCR'd page by page", async (t) => {
  const parts = await pages("scanned.pdf", t);
  if (!parts) return;
  assert.equal(parts.length, 2);
  for (const part of parts) {
    assert.ok(ocrd(part), part.markdown);
    assert.equal(part.ocrReason, "scanned-document");
    assert.match(part.markdown, /HELLO/);
  }
});

test("a mixed PDF keeps text pages structured and OCRs only the scanned page", async (t) => {
  const parts = await pages("mixed.pdf", t);
  if (!parts) return;
  assert.deepEqual(
    parts.map((part) => [part.source, part.ocrReason]),
    [
      ["text", null],
      ["ocr", "page-flagged"],
      ["text", null],
    ],
  );
  assert.match(parts[0]!.markdown, /Alpha digital page/);
  assert.match(parts[1]!.markdown, /HELLO/);
  assert.match(parts[2]!.markdown, /Gamma digital page/);
});

test("a document the classifier calls image-based is OCR'd whole, short text pages included", async (t) => {
  // The page-level extractor would keep the title page as text, but the document-level classifier lists every
  // page. Routing takes the union, so the title page is OCR'd: its words survive, its structure does not.
  const parts = await pages("short-text-and-scan.pdf", t);
  if (!parts) return;
  assert.deepEqual(parts.map((part) => part.ocrReason), ["scanned-document", "scanned-document", "scanned-document"]);
  assert.match(parts[0]!.markdown, /Alpha title page/);
  assert.match(parts[1]!.markdown, /HELLO/);
  assert.match(parts[2]!.markdown, /HELLO/);
});

test("a scan with a little native text is still OCR'd, so the scan is not dropped for the stamp", async (t) => {
  const parts = await pages("scan-with-stamp.pdf", t);
  if (!parts) return;
  assert.ok(ocrd(parts[0]), parts[0]!.markdown);
  assert.match(parts[0]!.markdown, /HELLO/);
});

test("a searchable scan is OCR'd by light-ocr; its invisible text layer is not used", async (t) => {
  const parts = await pages("searchable-scan.pdf", t);
  if (!parts) return;
  assert.equal(parts.length, 2);
  for (const part of parts) {
    assert.ok(ocrd(part), part.markdown);
    assert.equal(part.ocrReason, "scanned-document");
    assert.match(part.markdown, /HELLO/);
    assert.doesNotMatch(part.markdown, /Scanner layer words/);
  }
});

test("a text layer that does not decode falls back to OCR", async (t) => {
  const parts = await pages("cjk-predefined-cmap.pdf", t);
  if (!parts) return;
  assert.equal(parts[0]!.source, "ocr");
  assert.equal(parts[0]!.ocrReason, "garbled-text");
  assert.match(parts[0]!.markdown, /中文测试/);
});

test("convert() over the real engines joins the parts", async (t) => {
  if (!engine) {
    t.skip(unavailable ?? "native engines unavailable");
    return;
  }
  const result = await convert(await readFile(join(fixtures, "mixed.pdf")), { engine });
  assert.match(result.markdown, /Alpha digital page[\s\S]*HELLO[\s\S]*Gamma digital page/);
  assert.deepEqual(result.warnings, []);
});

test("a page too large to render at the default resolution is OCR'd at a lower one", async (t) => {
  const parts = await pages("large-scanned-page.pdf", t);
  if (!parts) return;
  assert.deepEqual(parts[0]!.warnings, []);
  assert.match(parts[0]!.markdown, /HELLO/);
});

test("a scanned PDF over 100 MiB is OCR'd page by page", async (t) => {
  if (!engine) {
    t.skip(unavailable ?? "native engines unavailable");
    return;
  }
  const bytes = padPdf(await readFile(join(fixtures, "scanned.pdf")), 101 * 1024 * 1024);
  const parts: ConvertPart[] = [];
  for await (const part of convertPages(bytes, { engine })) {
    parts.push(part);
  }
  assert.deepEqual(
    parts.map((part) => [part.page, /HELLO/.test(part.markdown), part.warnings]),
    [
      [1, true, []],
      [2, true, []],
    ],
  );
});

/**
 * Grows one of the generated fixtures to at least `size` bytes with comment lines after the header, shifting its
 * cross-reference offsets to match. Only for the simple, uncompressed layout the fixture generator writes.
 */
function padPdf(pdf: Uint8Array, size: number): Uint8Array {
  const text = Buffer.from(pdf).toString("latin1");
  const header = text.indexOf("\n", text.indexOf("\n") + 1) + 1;
  const line = `%${" ".repeat(1022)}\n`;
  const padding = line.repeat(Math.ceil(size / line.length));
  const shift = padding.length;
  const body = text.slice(header).replace(/^(\d{10}) 00000 n $/gm, (_, offset: string) =>
    `${String(Number(offset) + shift).padStart(10, "0")} 00000 n `,
  ).replace(/startxref\n(\d+)/, (_, offset: string) => `startxref\n${Number(offset) + shift}`);
  return Buffer.from(text.slice(0, header) + padding + body, "latin1");
}

test("link annotations become Markdown links; unsafe and internal links stay plain text", async (t) => {
  const parts = await pages("links.pdf", t);
  if (!parts) return;
  assert.equal(
    parts[0]!.markdown,
    "Read the [here-docs repository](https://github.com/AkaraChen/here-docs) for the details. " +
      "Write to [the maintainers](mailto:maintainers@example.com) with questions. " +
      "This script action stays plain text. Jump back to the top of this page.",
  );
});

test("text inside an image on a text page is OCR'd in place; a logo-sized image is not", async (t) => {
  const parts = await pages("text-with-image.pdf", t);
  if (!parts) return;
  assert.equal(parts[0]!.source, "mixed");
  assert.equal(parts[0]!.ocrReason, null);
  assert.match(parts[0]!.markdown, /scanned greeting[\s\S]*\n\nHELLO\n\nThe paragraph below the figure/);
  assert.equal(parts[1]!.source, "text");
  assert.doesNotMatch(parts[1]!.markdown, /HELLO/);
});

test("a blank scanned page yields an empty part", async (t) => {
  const parts = await pages("scan-with-blank-page.pdf", t);
  if (!parts) return;
  assert.match(parts[0]!.markdown, /HELLO/);
  assert.equal(parts[1]!.markdown, "");
});

// Known limitations. `todo` tests run and report, but do not fail the suite.

test("text in an optional content group hidden by default is left out", { todo: "known limitation: pdf-inspector ignores optional content visibility" }, async (t) => {
  const parts = await pages("hidden-layer.pdf", t);
  if (!parts) return;
  assert.match(parts[0]!.markdown, /Visible digital page/);
  assert.doesNotMatch(parts[0]!.markdown, /Hidden layer words/);
});

