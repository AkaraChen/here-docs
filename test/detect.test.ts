import assert from "node:assert/strict";
import { test } from "node:test";
import { detectImageFormat, detectKind, isPdfBytes } from "../src/detect.js";
import { gifBytes, jpegBytes, pdfBytes, pngBytes } from "./helpers.js";

const anydoc = {
  formatFromBytes: () => null as string | null,
  formatFromExtension: (ext: string) => (ext === "csv" ? "csv" : null),
  async toDocument() {
    return { blocks: [], notes: [], assets: [] };
  },
};

test("detects common image signatures", () => {
  assert.equal(detectImageFormat(jpegBytes), "jpeg");
  assert.equal(detectImageFormat(pngBytes), "png");
  assert.equal(detectImageFormat(gifBytes), "gif");
  assert.equal(
    detectImageFormat(Uint8Array.from(Buffer.from("RIFF....WEBP"))),
    "webp",
  );
});

test("detects PDF signatures", () => {
  assert.equal(isPdfBytes(pdfBytes), true);
  assert.equal(detectKind(pdfBytes, "x.bin", anydoc).kind, "pdf");
});

test("CSV needs a filename hint", () => {
  const bytes = Uint8Array.from(Buffer.from("a,b\n1,2\n"));
  assert.equal(detectKind(bytes, undefined, anydoc).kind, "unknown");
  assert.deepEqual(detectKind(bytes, "export.csv", anydoc), { kind: "office", format: "csv" });
});
