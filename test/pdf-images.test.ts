import assert from "node:assert/strict";
import { test } from "node:test";
import { convertPages } from "../src/convert.js";
import { WarningCode } from "../src/errors.js";
import { insertImageText } from "../src/markdown/pdf-images.js";
import type { ConvertPart, OcrLine, OcrPort, PdfInspectorPort, PdfPageItem } from "../src/types.js";
import { fakeDeps, pdfBytes } from "./helpers.js";

// A 400 × 400 pt page rendered at scale 2 (144 dpi): pixel (px, py) is point (px / 2, 400 - py / 2).
const RENDER = { rotation: 0, cropBox: { x: 0, y: 0, width: 400, height: 400 }, scale: 2 };

function text(value: string, y: number, x = 30, width = 300): PdfPageItem {
  return { page: 0, kind: "text", text: value, x, y, width, height: 12 };
}

function image(x: number, y: number, width: number, height: number): PdfPageItem {
  return { page: 0, kind: "image", text: "[Image]", x, y, width, height };
}

/** An OCR line whose box spans the given PDF points (origin bottom left). */
function line(value: string, x0: number, y0: number, x1: number, y1: number): OcrLine {
  const px = (x: number) => x * 2;
  const py = (y: number) => (400 - y) * 2;
  return {
    text: value,
    box: [
      { x: px(x0), y: py(y1) },
      { x: px(x1), y: py(y1) },
      { x: px(x1), y: py(y0) },
      { x: px(x0), y: py(y0) },
    ],
  };
}

const above = text("Text above the figure.", 300);
const below = text("Text below the figure.", 100);
const figure = image(80, 150, 240, 100);

function textPdf(markdown: string, items: PdfPageItem[]): PdfInspectorPort {
  return {
    async classify() {
      return { pdfType: "TextBased", pageCount: 1, pagesNeedingOcr: [] };
    },
    async process() {
      return { pdfType: "TextBased", pageCount: 1, pagesNeedingOcr: [], markdown };
    },
    async extractPagesMarkdown() {
      return [{ page: 0, markdown }];
    },
    async pageItems() {
      return items;
    },
  };
}

function pageOcr(lines: OcrLine[]): OcrPort & { calls: number } {
  const ocr = {
    calls: 0,
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument() {
      ocr.calls += 1;
      yield { index: 0, lines, render: RENDER };
    },
    async close() {},
  };
  return ocr;
}

async function onlyPart(pdf: PdfInspectorPort, ocr: OcrPort): Promise<ConvertPart> {
  const parts: ConvertPart[] = [];
  for await (const part of convertPages(pdfBytes, { engine: fakeDeps({ pdf, ocr }) })) {
    parts.push(part);
  }
  assert.equal(parts.length, 1);
  return parts[0]!;
}

test("text inside an image on a text page is inserted after the text above it", async () => {
  const ocr = pageOcr([
    line("Text above the figure.", 30, 298, 200, 312), // native text, read again by OCR
    line("HELLO", 120, 190, 220, 220),
    line("WORLD", 120, 160, 220, 185),
    line("Text below the figure.", 30, 98, 200, 112),
  ]);
  const part = await onlyPart(
    textPdf("Text above the figure.\n\nText below the figure.", [above, figure, below]),
    ocr,
  );
  assert.equal(part.markdown, "Text above the figure.\n\nHELLO\nWORLD\n\nText below the figure.");
  assert.equal(part.source, "mixed");
  assert.equal(part.ocrReason, null);
  assert.deepEqual(part.warnings, []);
});

test("native text drawn over an image is not repeated from OCR", async () => {
  const caption = text("Caption over the picture", 200, 100, 150);
  const ocr = pageOcr([line("Caption over the picture", 100, 198, 250, 212)]);
  const part = await onlyPart(textPdf("Text above the figure.\n\nCaption over the picture", [above, figure, caption]), ocr);
  assert.equal(part.markdown, "Text above the figure.\n\nCaption over the picture");
  assert.equal(part.source, "text");
});

test("images too small to hold text are not OCR'd", async () => {
  const ocr = pageOcr([line("LOGO", 360, 380, 390, 390)]);
  const part = await onlyPart(textPdf("Text above the figure.", [above, image(360, 380, 30, 10)]), ocr);
  assert.equal(ocr.calls, 0);
  assert.equal(part.source, "text");
});

test("a failed image OCR keeps the page text with a warning", async () => {
  const ocr: OcrPort = {
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument() {
      throw new Error("render failed");
    },
    async close() {},
  };
  const part = await onlyPart(textPdf("Text above the figure.", [above, figure]), ocr);
  assert.equal(part.markdown, "Text above the figure.");
  assert.equal(part.source, "text");
  assert.equal(part.warnings[0]?.code, WarningCode.pdfImageOcrFailed);
});

test("image text goes first when nothing is above the image, last when the text above cannot be found", () => {
  const top = image(80, 300, 240, 80);
  assert.equal(insertImageText("Body.", [below, top], [{ image: top, markdown: "TOP" }]), "TOP\n\nBody.");
  assert.equal(
    insertImageText("Rewritten | table", [above, figure], [{ image: figure, markdown: "FIG" }]),
    "Rewritten | table\n\nFIG",
  );
});

test("several images are inserted in page order", () => {
  const first = image(80, 220, 240, 60);
  const second = image(80, 120, 240, 60);
  const middle = text("Text between the figures.", 200);
  const markdown = "Text above the figure.\n\nText between the figures.\n\nText below the figure.";
  assert.equal(
    insertImageText(markdown, [above, middle, below, first, second], [
      { image: first, markdown: "ONE" },
      { image: second, markdown: "TWO" },
    ]),
    "Text above the figure.\n\nONE\n\nText between the figures.\n\nTWO\n\nText below the figure.",
  );
});
