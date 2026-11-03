import assert from "node:assert/strict";
import { test } from "node:test";
import { convertPages } from "../src/convert.js";
import type { AnydocDocument, ConvertPart, OcrPort, PdfInspectorPort } from "../src/types.js";
import { fakeDeps, jpegBytes, pdfBytes, pngBytes, trackingOcr } from "./helpers.js";

async function collect(parts: AsyncIterable<ConvertPart>): Promise<ConvertPart[]> {
  const out: ConvertPart[] = [];
  for await (const part of parts) {
    out.push(part);
  }
  return out;
}

function provenance(parts: ConvertPart[]): Array<[number | null, string, string | null]> {
  return parts.map((part) => [part.page, part.source, part.ocrReason]);
}

const ocrEveryPage = trackingOcr(
  Array.from({ length: 4 }, (_, index) => ({ index, lines: [{ text: `ocr ${index + 1}` }] })),
);

test("text pages are `text`; flagged and undecodable pages are `ocr` with their reason", async () => {
  const pdf: PdfInspectorPort = {
    async classify() {
      return { pdfType: "Mixed", pageCount: 4, pagesNeedingOcr: [1] };
    },
    async process() {
      return { pdfType: "Mixed", pageCount: 4, pagesNeedingOcr: [1], markdown: null };
    },
    async extractPagesMarkdown() {
      return [
        { page: 0, markdown: "one" },
        { page: 1, markdown: "" },
        { page: 2, markdown: "", needsOcr: true, ocrReason: "suspected_garbled_text" },
        { page: 3, markdown: "", needsOcr: true },
      ];
    },
  };
  const parts = await collect(convertPages(pdfBytes, { engine: fakeDeps({ pdf, ocr: ocrEveryPage }) }));
  assert.deepEqual(provenance(parts), [
    [1, "text", null],
    [2, "ocr", "page-flagged"],
    [3, "ocr", "garbled-text"],
    [4, "ocr", "page-flagged"],
  ]);
});

test("pages of a scanned document are `ocr` because of the document", async () => {
  const pdf: PdfInspectorPort = {
    async classify() {
      return { pdfType: "ImageBased", pageCount: 2, pagesNeedingOcr: [0, 1] };
    },
    async process() {
      return { pdfType: "ImageBased", pageCount: 2, pagesNeedingOcr: [0, 1], markdown: null };
    },
    async extractPagesMarkdown() {
      return null;
    },
  };
  const parts = await collect(convertPages(pdfBytes, { engine: fakeDeps({ pdf, ocr: ocrEveryPage }) }));
  assert.deepEqual(provenance(parts), [
    [1, "ocr", "scanned-document"],
    [2, "ocr", "scanned-document"],
  ]);
});

test("pages of a batch that fails to extract are OCR'd as `extraction-failed`", async () => {
  let calls = 0;
  const pdf: PdfInspectorPort = {
    async classify() {
      return { pdfType: "TextBased", pageCount: 9, pagesNeedingOcr: [] };
    },
    async process() {
      return { pdfType: "TextBased", pageCount: 9, pagesNeedingOcr: [], markdown: null };
    },
    async extractPagesMarkdown(_bytes, pages) {
      calls += 1;
      if (calls > 1) {
        throw new Error("parse error");
      }
      return (pages ?? []).map((page) => ({ page, markdown: `text ${page + 1}` }));
    },
  };
  const ocr = trackingOcr([{ index: 8, lines: [{ text: "ninth" }] }]);
  const parts = await collect(convertPages(pdfBytes, { engine: fakeDeps({ pdf, ocr }) }));
  assert.deepEqual(parts.at(-1) && provenance([parts.at(-1)!]), [[9, "ocr", "extraction-failed"]]);
  assert.ok(parts.slice(0, 8).every((part) => part.source === "text"));
});

test("a page whose OCR fails is `none` and keeps the reason it was sent to OCR", async () => {
  const ocr: OcrPort = {
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument() {
      throw new Error("render failed");
    },
    async close() {},
  };
  const pdf: PdfInspectorPort = {
    async classify() {
      return { pdfType: "Scanned", pageCount: 1, pagesNeedingOcr: [0] };
    },
    async process() {
      return { pdfType: "Scanned", pageCount: 1, pagesNeedingOcr: [0], markdown: null };
    },
    async extractPagesMarkdown() {
      return null;
    },
  };
  const [part] = await collect(convertPages(pdfBytes, { engine: fakeDeps({ pdf, ocr }) }));
  assert.deepEqual(provenance([part!]), [[1, "none", "scanned-document"]]);
  assert.equal(part!.warnings.length, 1);
});

test("images are `ocr`; office documents are `text`, or `mixed` once image OCR is spliced in", async () => {
  const image = await collect(convertPages(jpegBytes, { engine: fakeDeps() }));
  assert.deepEqual(provenance(image), [[null, "ocr", null]]);

  const withImage: AnydocDocument = {
    blocks: [{ kind: "paragraph", content: [{ kind: "image", alt: "", source: { kind: "asset", assetId: 0 } }] }],
    notes: [],
    assets: [{ id: 0, mediaType: "image/png", originPart: "word/media/1.png", data: pngBytes }],
  };
  const plain: AnydocDocument = {
    blocks: [{ kind: "paragraph", content: [{ kind: "text", text: "words" }] }],
    notes: [],
    assets: [],
  };
  for (const [document, source] of [
    [plain, "text"],
    [withImage, "mixed"],
  ] as const) {
    const engine = fakeDeps({
      anydoc: {
        formatFromBytes: () => "docx",
        formatFromExtension: () => "docx",
        async toDocument() {
          return document;
        },
      },
    });
    const parts = await collect(convertPages(Uint8Array.from(Buffer.from("PK\u0003\u0004")), { engine }));
    assert.deepEqual(provenance(parts), [[null, source, null]]);
  }
});

test("unknown and unconvertible inputs are `none`", async () => {
  const unknown = await collect(convertPages(Uint8Array.from([1, 2, 3]), { engine: fakeDeps() }));
  assert.deepEqual(provenance(unknown), [[null, "none", null]]);

  const encrypted = fakeDeps({
    anydoc: {
      formatFromBytes: () => "docx",
      formatFromExtension: () => "docx",
      async toDocument() {
        throw Object.assign(new Error("locked"), { code: "encrypted" });
      },
    },
  });
  const parts = await collect(convertPages(Uint8Array.from(Buffer.from("PK\u0003\u0004")), { engine: encrypted }));
  assert.deepEqual(provenance(parts), [[null, "none", null]]);
});

test("plain text is `text`; HTML is `text`, or `mixed` once an embedded image's OCR text is inserted", async () => {
  const text = await collect(convertPages(Uint8Array.from(Buffer.from("plain words\n")), { filename: "notes.txt", engine: fakeDeps() }));
  assert.deepEqual(provenance(text), [[null, "text", null]]);

  const png = Buffer.from(pngBytes).toString("base64");
  for (const [html, source] of [
    ["<html><body><p>Hello</p></body></html>", "text"],
    [`<html><body><p>Hello</p><img src="data:image/png;base64,${png}"></body></html>`, "mixed"],
  ] as const) {
    const parts = await collect(convertPages(Uint8Array.from(Buffer.from(html)), { filename: "page.html", engine: fakeDeps() }));
    assert.deepEqual(provenance(parts), [[null, source, null]]);
  }
});
