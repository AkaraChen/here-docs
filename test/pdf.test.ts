import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "../src/convert.js";
import { WarningCode } from "../src/errors.js";
import { FALLBACK_DPI } from "../src/ocr.js";
import type { OcrPort, PdfInspectorPort } from "../src/types.js";
import { fakeDeps, pdfBytes, trackingOcr } from "./helpers.js";

test("text-based PDFs keep structured markdown and skip whole-document OCR", async () => {
  const ocr = trackingOcr([]);
  const deps = fakeDeps({
    ocr,
    pdf: {
      async classify() {
        return { pdfType: "TextBased", pageCount: 2, pagesNeedingOcr: [] };
      },
      async process() {
        return {
          pdfType: "TextBased",
          pageCount: 2,
          pagesNeedingOcr: [],
          markdown: "# Structured\n",
        };
      },
      async extractPagesMarkdown() {
        return [
          { markdown: "# Page one", page: 0 },
          { markdown: "# Page two", page: 1 },
        ];
      },
    },
  });
  const result = await convert(pdfBytes, { engine: deps });
  assert.match(result.markdown, /Page one/);
  assert.match(result.markdown, /Page two/);
  assert.equal(ocr.documentRanges.length, 0);
});

test("scanned PDFs OCR every page, one page per OCR request", async () => {
  const ocr = trackingOcr([
    { index: 0, lines: [{ text: "scan-a" }] },
    { index: 1, lines: [{ text: "scan-b" }] },
  ]);
  const deps = fakeDeps({
    ocr,
    pdf: {
      async classify() {
        return { pdfType: "Scanned", pageCount: 2, pagesNeedingOcr: [0, 1] };
      },
      async process() {
        return { pdfType: "Scanned", pageCount: 2, pagesNeedingOcr: [0, 1], markdown: null };
      },
      async extractPagesMarkdown() {
        return null;
      },
    },
  });
  const result = await convert(pdfBytes, { engine: deps });
  assert.match(result.markdown, /scan-a/);
  assert.match(result.markdown, /scan-b/);
  assert.deepEqual(ocr.documentRanges, [
    { start: 1, end: 1 },
    { start: 2, end: 2 },
  ]);
});

test("mixed PDFs OCR only pagesNeedingOcr using 1-based ranges", async () => {
  const ocr = trackingOcr([{ index: 1, lines: [{ text: "scanned middle" }] }]);
  const deps = fakeDeps({
    ocr,
    pdf: {
      async classify() {
        return { pdfType: "Mixed", pageCount: 3, pagesNeedingOcr: [1] };
      },
      async process() {
        return { pdfType: "Mixed", pageCount: 3, pagesNeedingOcr: [1], markdown: "partial" };
      },
      async extractPagesMarkdown() {
        return [
          { markdown: "# Digital one", page: 0 },
          { markdown: "", page: 1, needsOcr: true },
          { markdown: "# Digital three", page: 2 },
        ];
      },
    },
  });
  const result = await convert(pdfBytes, { engine: deps });
  assert.match(result.markdown, /Digital one/);
  assert.match(result.markdown, /scanned middle/);
  assert.match(result.markdown, /Digital three/);
  assert.deepEqual(ocr.documentRanges, [{ start: 2, end: 2 }]);
});

test("an OCR'd page with no recognized text yields empty markdown, not a bare heading", async () => {
  const ocr = trackingOcr([
    { index: 0, lines: [{ text: "scan" }] },
    { index: 1, lines: [] },
  ]);
  const deps = fakeDeps({
    ocr,
    pdf: {
      async classify() {
        return { pdfType: "Scanned", pageCount: 2, pagesNeedingOcr: [0, 1] };
      },
      async process() {
        return { pdfType: "Scanned", pageCount: 2, pagesNeedingOcr: [0, 1], markdown: null };
      },
      async extractPagesMarkdown() {
        return null;
      },
    },
  });
  const result = await convert(pdfBytes, { engine: deps });
  assert.equal(result.markdown, "## Page 1\n\nscan\n");
});

function scannedPdf(pageCount: number): PdfInspectorPort {
  const pages = Array.from({ length: pageCount }, (_, index) => index);
  return {
    async classify() {
      return { pdfType: "Scanned", pageCount, pagesNeedingOcr: pages };
    },
    async process() {
      return { pdfType: "Scanned", pageCount, pagesNeedingOcr: pages, markdown: null };
    },
    async extractPagesMarkdown() {
      return null;
    },
  };
}

function limitError(): Error & { code: string } {
  return Object.assign(new Error("Page 1 rendered pixels 35420000 exceeds maxPagePixels 16777216"), {
    code: "resource_limit_exceeded",
  });
}

test("a page over the OCR pixel limit is retried at lower resolutions", async () => {
  const resolutions: Array<number | undefined> = [];
  const ocr: OcrPort = {
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument(_bytes, options) {
      resolutions.push(options?.dpi);
      if (options?.dpi === undefined) {
        throw limitError();
      }
      yield { index: 0, lines: [{ text: "poster" }] };
    },
    async close() {},
  };
  const result = await convert(pdfBytes, { engine: fakeDeps({ ocr, pdf: scannedPdf(1) }) });
  assert.equal(result.markdown, "## Page 1\n\nposter\n");
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(resolutions, [undefined, FALLBACK_DPI[0]]);
});

test("a page over the pixel limit at every resolution becomes a page warning", async () => {
  const resolutions: Array<number | undefined> = [];
  const ocr: OcrPort = {
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument(_bytes, options) {
      resolutions.push(options?.dpi);
      throw limitError();
    },
    async close() {},
  };
  const result = await convert(pdfBytes, { engine: fakeDeps({ ocr, pdf: scannedPdf(1) }) });
  assert.equal(result.markdown, "");
  assert.equal(result.warnings[0]?.code, WarningCode.pdfPageOcrFailed);
  assert.deepEqual(resolutions, [undefined, ...FALLBACK_DPI]);
});
