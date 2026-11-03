import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "../src/convert.js";
import { IllegalConvertInputError, WarningCode } from "../src/errors.js";
import type { AnydocDocument } from "../src/types.js";
import { fakeDeps, gifBytes, jpegBytes, labelledPng, labelOcr, pdfBytes, pngBytes } from "./helpers.js";

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

test("SVG assets in office documents contribute their text; text-less drawings are rendered and OCR'd", async () => {
  const withText = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>Quarterly revenue</text></svg>'));
  const outlined = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>'));
  let rendered = 0;
  const deps = fakeDeps({
    anydoc: {
      formatFromBytes: () => "docx",
      formatFromExtension: () => "docx",
      async toDocument() {
        return {
          blocks: [
            { kind: "paragraph", content: [{ kind: "image", alt: "chart", source: { kind: "asset", assetId: 3 } }] },
            { kind: "paragraph", content: [{ kind: "image", alt: "logo", source: { kind: "asset", assetId: 4 } }] },
          ],
          notes: [],
          assets: [
            { id: 3, mediaType: "image/svg+xml", originPart: "word/media/image1.svg", data: withText },
            { id: 4, mediaType: "image/svg+xml", originPart: "word/media/image2.svg", data: outlined },
          ],
        };
      },
    },
    images: {
      async toPng() {
        rendered += 1;
        return pngBytes;
      },
    },
  });
  const result = await convert(Uint8Array.from(Buffer.from("PK\u0003\u0004office")), { engine: deps });
  assert.equal(rendered, 1);
  assert.equal(result.markdown, "Quarterly revenue\n\nOCR\n");
  assert.deepEqual(result.warnings, []);
});

test("an image above the OCR engine's size limits is shrunk and retried", async () => {
  const sizes: number[] = [];
  const deps = fakeDeps({
    ocr: {
      async recognizeEncoded(bytes) {
        sizes.push(bytes.length);
        if (bytes.length > 6) {
          throw Object.assign(new Error("Decoded image dimensions exceed engine limits"), { code: "resource_limit_exceeded" });
        }
        return { lines: [{ text: "SHRUNK" }] };
      },
      async *recognizeDocument() {},
      async close() {},
    },
    images: {
      async toPng(bytes) {
        return bytes;
      },
      async fitForOcr() {
        return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      },
    },
  });
  const result = await convert(pngBytes, { engine: deps });
  assert.equal(result.markdown, "SHRUNK\n");
  assert.deepEqual(sizes, [pngBytes.length, 6]);
});

test("BMP images are recognized and decoded before OCR", async () => {
  const { decodeBmp } = await import("../src/bmp.js");
  // 2x2, 24-bit, bottom-up: red, green / blue, white.
  const bmp = Buffer.alloc(54 + 16);
  bmp.write("BM", 0, "latin1");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(2, 18);
  bmp.writeInt32LE(2, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  Buffer.from([0xff, 0, 0, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0xff, 0, 0xff, 0, 0, 0]).copy(bmp, 54);
  const image = decodeBmp(bmp);
  assert.deepEqual([...image.data], [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const { detectImageFormat } = await import("../src/detect.js");
  assert.equal(detectImageFormat(bmp), "bmp");
});

test("office images that the document does not place are not OCR'd, unless the document is only pictures", async () => {
  const ocr = labelOcr();
  const documentWith = (blocks: AnydocDocument["blocks"]): AnydocDocument => ({
    blocks,
    notes: [],
    assets: [
      { id: 0, mediaType: "image/png", originPart: "ppt/media/image1.png", data: labelledPng("SLIDE ONE") },
      { id: 1, mediaType: "image/png", originPart: "ppt/media/image2.png", data: labelledPng("SLIDE TWO") },
    ],
  });
  const engineFor = (document: AnydocDocument) =>
    fakeDeps({
      ocr,
      anydoc: { formatFromBytes: () => "ppt", formatFromExtension: () => "ppt", toDocument: async () => document },
    });
  const pictures = await convert(Uint8Array.from(Buffer.from("PK\u0003\u0004deck")), { engine: engineFor(documentWith([])) });
  assert.equal(pictures.markdown, "SLIDE ONE\n\nSLIDE TWO\n");
  ocr.encoded.length = 0;
  const text = await convert(Uint8Array.from(Buffer.from("PK\u0003\u0004deck")), {
    engine: engineFor(documentWith([{ kind: "paragraph", content: [{ kind: "text", text: "Agenda" }] }])),
  });
  assert.equal(text.markdown, "Agenda\n");
  assert.deepEqual(ocr.encoded, []);
});
