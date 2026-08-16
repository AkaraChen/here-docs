import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "../src/convert.js";
import { IllegalConvertInputError, WarningCode } from "../src/errors.js";
import type { AnydocDocument } from "../src/types.js";
import { fakeDeps, gifBytes, jpegBytes, pdfBytes, pngBytes } from "./helpers.js";

test("convert rejects a string argument", async () => {
  await assert.rejects(
    () => convert("report.docx" as unknown as Uint8Array, { engine: fakeDeps() }),
    IllegalConvertInputError,
  );
});

test("convert rejects a missing engine", async () => {
  await assert.rejects(
    () => convert(jpegBytes, {} as { engine: never }),
    (error: unknown) =>
      error instanceof IllegalConvertInputError &&
      error.message.includes("createEngine"),
  );
});

test("unknown bytes return empty markdown and a warning", async () => {
  const result = await convert(Uint8Array.from([0, 1, 2, 3]), { engine: fakeDeps() });
  assert.equal(result.markdown, "");
  assert.equal(result.warnings[0]?.code, WarningCode.unknownType);
});

test("convert does not close the caller-owned engine", async () => {
  let closed = false;
  const engine = fakeDeps({
    ocr: {
      async recognizeEncoded() {
        return { lines: [{ text: "HELLO" }] };
      },
      async *recognizeDocument() {},
      async close() {
        closed = true;
      },
    },
  });
  await convert(jpegBytes, { engine });
  assert.equal(closed, false);
  await engine.close();
  assert.equal(closed, true);
});

test("raster images use OCR only", async () => {
  const deps = fakeDeps({
    ocr: {
      async recognizeEncoded() {
        return { lines: [{ text: "HELLO" }, { text: "WORLD" }] };
      },
      async *recognizeDocument() {},
      async close() {},
    },
  });
  const result = await convert(jpegBytes, { engine: deps });
  assert.equal(result.markdown, "HELLO\nWORLD\n");
  assert.deepEqual(result.warnings, []);
});

test("office documents splice asset OCR at the image position", async () => {
  const document: AnydocDocument = {
    blocks: [
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Hello ", style: { bold: false, italic: false, strike: false, code: false } },
          { kind: "image", alt: "figure", source: { kind: "asset", assetId: 0 } },
          { kind: "text", text: " end", style: { bold: false, italic: false, strike: false, code: false } },
        ],
      },
    ],
    notes: [],
    assets: [{ id: 0, mediaType: "image/png", originPart: "word/media/1.png", data: pngBytes }],
  };
  const deps = fakeDeps({
    anydoc: {
      formatFromBytes: () => "docx",
      formatFromExtension: () => "docx",
      async toDocument() {
        return document;
      },
    },
    ocr: {
      async recognizeEncoded() {
        return { lines: [{ text: "OCR TEXT" }] };
      },
      async *recognizeDocument() {},
      async close() {},
    },
  });
  const result = await convert(Uint8Array.from(Buffer.from("PK\u0003\u0004office")), {
    filename: "doc.docx",
    engine: deps,
  });
  assert.equal(result.markdown, "Hello OCR TEXT end\n");
  assert.ok(!result.markdown.includes("figure"));
});

test("encrypted office documents warn and do not throw", async () => {
  const error = Object.assign(new Error("locked"), { code: "encrypted" });
  const deps = fakeDeps({
    anydoc: {
      formatFromBytes: () => "docx",
      formatFromExtension: () => "docx",
      async toDocument() {
        throw error;
      },
    },
  });
  const result = await convert(Uint8Array.from(Buffer.from("PK\u0003\u0004office")), {
    filename: "a.docx",
    engine: deps,
  });
  assert.equal(result.markdown, "");
  assert.equal(result.warnings[0]?.code, WarningCode.encrypted);
});

test("transcode failure is a warning", async () => {
  const deps = fakeDeps({
    images: {
      async toPng() {
        throw new Error("cannot decode heic");
      },
    },
  });
  const result = await convert(gifBytes, { filename: "x.gif", engine: deps });
  assert.equal(result.markdown, "");
  assert.equal(result.warnings[0]?.code, WarningCode.transcodeFailed);
});

test("filename hint selects CSV", async () => {
  const deps = fakeDeps({
    anydoc: {
      formatFromBytes: () => null,
      formatFromExtension: (ext) => (ext === "csv" ? "csv" : null),
      async toDocument() {
        return {
          blocks: [
            {
              kind: "paragraph",
              content: [
                {
                  kind: "text",
                  text: "a,b",
                  style: { bold: false, italic: false, strike: false, code: false },
                },
              ],
            },
          ],
          notes: [],
          assets: [],
        };
      },
    },
  });
  const result = await convert(Uint8Array.from(Buffer.from("a,b\n1,2\n")), {
    filename: "table.csv",
    engine: deps,
  });
  assert.equal(result.markdown, "a,b\n");
});

test("pdf magic is not sent through office conversion", async () => {
  let officeCalled = false;
  const deps = fakeDeps({
    anydoc: {
      formatFromBytes: () => "pdf",
      formatFromExtension: () => "pdf",
      async toDocument() {
        officeCalled = true;
        throw new Error("should not parse pdf as office");
      },
    },
    pdf: {
      async classify() {
        return { pdfType: "TextBased", pageCount: 1, pagesNeedingOcr: [] };
      },
      async process() {
        return {
          pdfType: "TextBased",
          pageCount: 1,
          pagesNeedingOcr: [],
          markdown: "Text PDF\n",
        };
      },
      async extractPagesMarkdown() {
        return [{ markdown: "Text PDF", page: 0 }];
      },
    },
  });
  const result = await convert(pdfBytes, { engine: deps });
  assert.equal(officeCalled, false);
  assert.match(result.markdown, /Text PDF/);
});
