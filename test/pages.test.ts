import assert from "node:assert/strict";
import { test } from "node:test";
import { convert, convertPages } from "../src/convert.js";
import { IllegalConvertInputError, WarningCode } from "../src/errors.js";
import type { ConvertPart, OcrPort, PdfInspectorPort } from "../src/types.js";
import { fakeDeps, jpegBytes, pdfBytes, trackingOcr } from "./helpers.js";

/** A text PDF of `pageCount` pages; `ocrPages` (0-based) need OCR. Records every extraction request. */
function textPdf(pageCount: number, ocrPages: number[] = []): PdfInspectorPort & { requests: number[][] } {
  const requests: number[][] = [];
  return {
    requests,
    async classify() {
      return { pdfType: ocrPages.length ? "Mixed" : "TextBased", pageCount, pagesNeedingOcr: ocrPages };
    },
    async process() {
      return { pdfType: "TextBased", pageCount, pagesNeedingOcr: ocrPages, markdown: "whole" };
    },
    async extractPagesMarkdown(_bytes, pages) {
      const wanted = pages ?? Array.from({ length: pageCount }, (_, i) => i);
      requests.push(wanted);
      return wanted.map((page) => ({ page, markdown: ocrPages.includes(page) ? "" : `text ${page + 1}` }));
    },
  };
}

async function collect(parts: AsyncIterable<ConvertPart>, limit = Number.POSITIVE_INFINITY): Promise<ConvertPart[]> {
  const out: ConvertPart[] = [];
  for await (const part of parts) {
    out.push(part);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

test("convertPages yields one part per PDF page in order, with the page count", async () => {
  const ocr = trackingOcr([{ index: 1, lines: [{ text: "scanned two" }] }]);
  const engine = fakeDeps({ ocr, pdf: textPdf(3, [1]) });
  const parts = await collect(convertPages(pdfBytes, { engine }));
  assert.deepEqual(
    parts.map((p) => [p.page, p.pageCount]),
    [
      [1, 3],
      [2, 3],
      [3, 3],
    ],
  );
  assert.equal(parts[0]?.markdown, "text 1");
  assert.match(parts[1]?.markdown ?? "", /scanned two/);
  assert.equal(parts[2]?.markdown, "text 3");
});

test("stopping early skips the remaining OCR and extraction", async () => {
  const ocr = trackingOcr([0, 1, 2, 3].map((index) => ({ index, lines: [{ text: `scan ${index + 1}` }] })));
  const pdf: PdfInspectorPort = {
    async classify() {
      return { pdfType: "Scanned", pageCount: 4, pagesNeedingOcr: [0, 1, 2, 3] };
    },
    async process() {
      throw new Error("not used");
    },
    async extractPagesMarkdown() {
      throw new Error("not used");
    },
  };
  const parts = await collect(convertPages(pdfBytes, { engine: fakeDeps({ ocr, pdf }) }), 2);
  assert.equal(parts.length, 2);
  assert.deepEqual(ocr.documentRanges, [
    { start: 1, end: 1 },
    { start: 2, end: 2 },
  ]);

  const text = textPdf(200);
  await collect(convertPages(pdfBytes, { engine: fakeDeps({ pdf: text }) }), 3);
  assert.deepEqual(text.requests, [[0, 1, 2, 3, 4, 5, 6, 7]]);
});

test("text pages are extracted in growing batches", async () => {
  const pdf = textPdf(20);
  const parts = await collect(convertPages(pdfBytes, { engine: fakeDeps({ pdf }) }));
  assert.equal(parts.length, 20);
  assert.deepEqual(
    pdf.requests.map((r) => [r[0], r.at(-1)]),
    [
      [0, 7],
      [8, 19],
    ],
  );
});

test("convert joins the parts into one manuscript", async () => {
  const result = await convert(pdfBytes, { engine: fakeDeps({ pdf: textPdf(2) }) });
  assert.equal(result.markdown, "text 1\n\ntext 2\n");
});

test("a failed page OCR becomes a warning on that page; the other pages remain", async () => {
  const ocr: OcrPort = {
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument(_bytes, options) {
      if (options?.pageRange?.start === 2) {
        throw new Error("boom");
      }
      yield { index: (options?.pageRange?.start ?? 1) - 1, lines: [{ text: "ok" }] };
    },
    async close() {},
  };
  const pdf: PdfInspectorPort = {
    async classify() {
      return { pdfType: "Scanned", pageCount: 3, pagesNeedingOcr: [0, 1, 2] };
    },
    async process() {
      throw new Error("not used");
    },
    async extractPagesMarkdown() {
      return null;
    },
  };
  const parts = await collect(convertPages(pdfBytes, { engine: fakeDeps({ ocr, pdf }) }));
  assert.equal(parts.length, 3);
  assert.equal(parts[1]?.markdown, "");
  assert.equal(parts[1]?.warnings[0]?.code, WarningCode.pdfPageOcrFailed);
  assert.match(parts[0]?.markdown ?? "", /ok/);
  assert.match(parts[2]?.markdown ?? "", /ok/);
});

test("non-paged inputs yield exactly one part with page null", async () => {
  const parts = await collect(convertPages(jpegBytes, { engine: fakeDeps() }));
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.page, null);
  assert.equal(parts[0]?.pageCount, null);
  assert.equal(parts[0]?.markdown, "OCR");
});

test("convertPages throws on an illegal call before iteration", () => {
  assert.throws(() => convertPages("x.pdf" as unknown as Uint8Array, { engine: fakeDeps() }), IllegalConvertInputError);
  assert.throws(() => convertPages(pdfBytes, {} as { engine: never }), IllegalConvertInputError);
});

test("an already-aborted signal rejects with its reason and does no work", async () => {
  const ocr = trackingOcr([]);
  const reason = new Error("stop");
  await assert.rejects(
    () => convert(jpegBytes, { engine: fakeDeps({ ocr }), signal: AbortSignal.abort(reason) }),
    (error) => error === reason,
  );
  assert.equal(ocr.encodedCalls, 0);
});

test("aborting during OCR rejects instead of becoming a warning", async () => {
  const controller = new AbortController();
  const seen: Array<AbortSignal | undefined> = [];
  const ocr: OcrPort = {
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument(_bytes, options) {
      seen.push(options?.signal);
      controller.abort(new Error("cancelled"));
      options?.signal?.throwIfAborted();
      yield { index: 0, lines: [] };
    },
    async close() {},
  };
  const pdf: PdfInspectorPort = {
    async classify() {
      return { pdfType: "Scanned", pageCount: 5, pagesNeedingOcr: [0, 1, 2, 3, 4] };
    },
    async process() {
      throw new Error("not used");
    },
    async extractPagesMarkdown() {
      return null;
    },
  };
  await assert.rejects(
    () => convert(pdfBytes, { engine: fakeDeps({ ocr, pdf }), signal: controller.signal }),
    /cancelled/,
  );
  assert.equal(seen.length, 1, "no page after the abort is OCR'd");
  assert.equal(seen[0], controller.signal, "the signal reaches the OCR engine");
});

test("aborting between pages stops the iterator", async () => {
  const controller = new AbortController();
  const pages = convertPages(pdfBytes, { engine: fakeDeps({ pdf: textPdf(3) }), signal: controller.signal });
  const first = await pages.next();
  assert.equal(first.value?.page, 1);
  controller.abort(new Error("enough"));
  await assert.rejects(() => pages.next(), /enough/);
});
