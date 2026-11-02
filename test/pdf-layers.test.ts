import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { convertPages } from "../src/convert.js";
import { WarningCode } from "../src/errors.js";
import { removeRuns } from "../src/markdown/remove-runs.js";
import { hidesOptionalContent, unseenRuns } from "../src/strategies/pdf-layers.js";
import type { ConvertPart, OcrLine, OcrPage, OcrPort, PdfInspectorPort, PdfPageItem } from "../src/types.js";
import { fakeDeps } from "./helpers.js";

const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, "latin1");

test("detects optional content turned off by default, in the raw bytes or a compressed object stream", () => {
  const catalog = "1 0 obj << /Type /Catalog /OCProperties << /OCGs [5 0 R] /D << /OFF [5 0 R] >> >> >> endobj";
  assert.equal(hidesOptionalContent(pdf(catalog)), true);
  assert.equal(
    hidesOptionalContent(pdf("1 0 obj << /OCProperties << /OCGs [5 0 R] /D << /BaseState /OFF /ON [5 0 R] >> >> >> endobj")),
    true,
  );

  const compressed = deflateSync(Buffer.from("<< /Type /Catalog /OCProperties 7 0 R >> << /D << /OFF [ 5 0 R ] >> >>"));
  const objectStream = Buffer.concat([
    Buffer.from("%PDF-1.7\n9 0 obj << /Type /ObjStm /N 2 /First 8 /Filter /FlateDecode >>\nstream\n", "latin1"),
    compressed,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
  assert.equal(hidesOptionalContent(objectStream), true);
});

test("does not flag layers that are all on, documents without layers, or checkbox /Off states", () => {
  assert.equal(hidesOptionalContent(pdf("1 0 obj << /OCProperties << /OCGs [5 0 R] /D << /OFF [] >> >> >> endobj")), false);
  assert.equal(hidesOptionalContent(pdf("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj")), false);
  assert.equal(hidesOptionalContent(pdf("4 0 obj << /AS /Off /AP << /N << /Off 6 0 R >> >> >> endobj")), false);
});

// A 400 × 200 pt page rendered at scale 2: pixel (px, py) is point (px / 2, 200 - py / 2).
const RENDER = { rotation: 0, cropBox: { x: 0, y: 0, width: 400, height: 200 }, scale: 2 };

function run(text: string, y: number, height = 12, x = 30, width = 200): PdfPageItem {
  return { page: 0, kind: "text", text, x, y, width, height };
}

/** An OCR line over the PDF box from (x0, y0) to (x1, y1). */
function seen(x0: number, y0: number, x1: number, y1: number, text = "seen"): OcrLine {
  const px = (x: number) => x * 2;
  const py = (y: number) => (200 - y) * 2;
  return { text, box: [{ x: px(x0), y: py(y1) }, { x: px(x1), y: py(y1) }, { x: px(x1), y: py(y0) }, { x: px(x0), y: py(y0) }] };
}

function ocrPage(lines: OcrLine[], render: OcrPage["render"] = RENDER): OcrPage[] {
  return [{ index: 0, lines, render }];
}

test("runs no OCR line touches are unseen", () => {
  const shown = [run("Body text one", 160), run("Body text two", 140), run("Body text three", 120)];
  const hidden = run("Hidden layer words", 60);
  const lines = [seen(30, 157, 230, 172), seen(30, 137, 230, 152), seen(30, 117, 230, 132)];
  assert.deepEqual(unseenRuns(ocrPage(lines), [...shown, hidden]), [hidden]);
});

test("small, short, out-of-page runs are never judged, and a page where most runs look unseen keeps all", () => {
  const lines = [seen(30, 157, 230, 172)];
  const body = run("Body text one", 160);
  const tiny = run("Footnote label", 60, 6);
  const bullet = run("•", 40);
  const offPage = run("Rotated table cell", -80);
  // Of the unseen runs, only the ordinary one is judged; the rest are kept.
  const missed = run("Body two", 140);
  assert.deepEqual(unseenRuns(ocrPage(lines), [body, missed, tiny, bullet, offPage, run("x", 20)]), [missed]);
  assert.deepEqual(unseenRuns(ocrPage(lines), [body, tiny, bullet, offPage]), []);

  const many = [run("Alpha words", 100), run("Beta words", 80), run("Gamma words", 60)];
  assert.deepEqual(unseenRuns(ocrPage(lines), [body, ...many]), []);
});

test("a page whose OCR saw nothing, or that cannot be mapped, keeps every run", () => {
  const runs = [run("Body text one", 160), run("Hidden layer words", 60)];
  assert.deepEqual(unseenRuns(ocrPage([]), runs), []);
  assert.deepEqual(unseenRuns(ocrPage([seen(30, 157, 230, 172)], { ...RENDER, rotation: 90 }), runs), []);
  assert.deepEqual(unseenRuns([{ index: 0, lines: [seen(30, 157, 230, 172)] }], runs), []);
});

test("removing a run drops its words and any markup line it leaves behind", () => {
  assert.equal(
    removeRuns("Visible text.\n\n## Hidden layer words\n\nMore text.", [run("Hidden layer words", 60)]),
    "Visible text.\n\nMore text.",
  );
  assert.equal(removeRuns("Before Hidden note after.", [run("Hidden note", 60)]), "Before after.");
  assert.equal(removeRuns("Nothing to remove.", [run("Absent words", 60)]), "Nothing to remove.");
});

function layeredPdf(markdown: string, items: PdfPageItem[]): PdfInspectorPort {
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

const layeredBytes = pdf("1 0 obj << /Type /Catalog /OCProperties << /OCGs [5 0 R] /D << /OFF [5 0 R] >> >> >> endobj");
const plainBytes = pdf("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");

async function onlyPart(bytes: Uint8Array, pdfPort: PdfInspectorPort, ocr: OcrPort): Promise<ConvertPart> {
  const parts: ConvertPart[] = [];
  for await (const part of convertPages(bytes, { engine: fakeDeps({ pdf: pdfPort, ocr }) })) {
    parts.push(part);
  }
  return parts[0]!;
}

function pageOcr(lines: OcrLine[]): OcrPort & { calls: number } {
  const port = {
    calls: 0,
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument() {
      port.calls += 1;
      yield { index: 0, lines, render: RENDER };
    },
    async close() {},
  };
  return port;
}

const shownRuns = [run("Body text one", 160), run("Body text two", 140), run("Body text three", 120)];
const shownLines = [seen(30, 157, 230, 172), seen(30, 137, 230, 152), seen(30, 117, 230, 132)];
const layeredMarkdown = "Body text one Body text two Body text three\n\n## Hidden layer words";

test("in a document that hides layers, text the rendered page does not show is dropped", async () => {
  const part = await onlyPart(
    layeredBytes,
    layeredPdf(layeredMarkdown, [...shownRuns, run("Hidden layer words", 60)]),
    pageOcr(shownLines),
  );
  assert.equal(part.markdown, "Body text one Body text two Body text three");
  assert.equal(part.source, "text");
  assert.deepEqual(part.warnings, []);
});

test("documents without hidden layers are not OCR'd for the check", async () => {
  const ocr = pageOcr(shownLines);
  const part = await onlyPart(plainBytes, layeredPdf(layeredMarkdown, [...shownRuns, run("Hidden layer words", 60)]), ocr);
  assert.equal(ocr.calls, 0);
  assert.equal(part.markdown, layeredMarkdown);
});

test("a failed layer check keeps the extracted text with a warning", async () => {
  const ocr: OcrPort = {
    async recognizeEncoded() {
      return { lines: [] };
    },
    async *recognizeDocument() {
      throw new Error("render failed");
    },
    async close() {},
  };
  const part = await onlyPart(layeredBytes, layeredPdf(layeredMarkdown, shownRuns), ocr);
  assert.equal(part.markdown, layeredMarkdown);
  assert.equal(part.warnings[0]?.code, WarningCode.pdfLayerCheckFailed);
});
