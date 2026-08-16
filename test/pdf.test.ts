import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "../src/convert.js";
import { toOneBasedRanges } from "../src/ocr.js";
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
  const result = await convert(pdfBytes, {}, deps);
  assert.match(result.markdown, /Page one/);
  assert.match(result.markdown, /Page two/);
  assert.equal(ocr.documentRanges.length, 0);
});

test("scanned PDFs OCR the whole document", async () => {
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
  const result = await convert(pdfBytes, {}, deps);
  assert.match(result.markdown, /scan-a/);
  assert.match(result.markdown, /scan-b/);
  assert.equal(ocr.documentRanges.length, 1);
  assert.deepEqual(ocr.documentRanges[0], {});
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
  const result = await convert(pdfBytes, {}, deps);
  assert.match(result.markdown, /Digital one/);
  assert.match(result.markdown, /scanned middle/);
  assert.match(result.markdown, /Digital three/);
  assert.deepEqual(ocr.documentRanges, [{ start: 2, end: 2 }]);
});

test("toOneBasedRanges converts 0-based page lists", () => {
  assert.deepEqual(toOneBasedRanges([0, 1, 4]), [
    { start: 1, end: 2 },
    { start: 5, end: 5 },
  ]);
});
