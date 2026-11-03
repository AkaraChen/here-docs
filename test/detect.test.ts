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

test("CSV needs a filename hint to become a table; without one it is plain text", () => {
  const bytes = Uint8Array.from(Buffer.from("a,b\n1,2\n"));
  assert.deepEqual(detectKind(bytes, undefined, anydoc), { kind: "text", format: "plain" });
  assert.deepEqual(detectKind(bytes, "export.csv", anydoc), { kind: "office", format: "csv" });
});

test("text markers detect HTML, SVG, e-mail, web archives, notebooks, and plain text", () => {
  const kind = (text: string, filename?: string) => detectKind(Uint8Array.from(Buffer.from(text)), filename, anydoc);
  assert.deepEqual(kind("<!DOCTYPE html><html><body>x</body></html>"), { kind: "html" });
  assert.deepEqual(kind('<?xml version="1.0"?>\n<html xmlns="http://www.w3.org/1999/xhtml"></html>'), { kind: "html" });
  assert.deepEqual(kind('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'), { kind: "image", format: "svg" });
  assert.deepEqual(kind("From: a@example.com\r\nTo: b@example.com\r\nSubject: hi\r\n\r\nbody"), { kind: "message", format: "eml" });
  assert.deepEqual(
    kind('From: <Saved by Blink>\r\nSnapshot-Content-Location: https://x\r\nContent-Type: multipart/related;\r\n\tboundary="b"\r\n\r\n--b'),
    { kind: "message", format: "mhtml" },
  );
  assert.deepEqual(kind('{\n "cells": [],\n "metadata": {},\n "nbformat": 4\n}'), { kind: "notebook" });
  assert.deepEqual(kind("Just some notes.\nKey: value\n"), { kind: "text", format: "plain" });
});

test("a filename hint wins over text markers", () => {
  const html = Uint8Array.from(Buffer.from("<html><body>x</body></html>"));
  assert.deepEqual(detectKind(html, "source.txt", anydoc), { kind: "text", format: "plain" });
  assert.deepEqual(detectKind(Uint8Array.from(Buffer.from("# Title")), "notes.md", anydoc), { kind: "text", format: "markdown" });
});

test("templates, WPS binaries, and TSV map to their parsers by extension", () => {
  const bytes = Uint8Array.from([0x01, 0x00, 0x02, 0x00]);
  const office = (name: string) => detectKind(bytes, name, anydoc);
  assert.deepEqual(office("letter.dotx"), { kind: "office", format: "docx" });
  assert.deepEqual(office("budget.xltx"), { kind: "office", format: "xlsx" });
  assert.deepEqual(office("deck.potx"), { kind: "office", format: "pptx" });
  assert.deepEqual(office("memo.ott"), { kind: "office", format: "odt" });
  assert.deepEqual(office("report.wps"), { kind: "office", format: "doc" });
  assert.deepEqual(office("sheet.et"), { kind: "office", format: "xlsx" });
  assert.deepEqual(office("slides.dps"), { kind: "office", format: "ppt" });
  assert.deepEqual(office("data.tsv"), { kind: "office", format: "csv" });
});

test("ZIP and OLE signatures identify OFD and Outlook messages", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const ofd = zipSync({ "OFD.xml": strToU8("<ofd:OFD/>") });
  assert.deepEqual(detectKind(ofd, undefined, anydoc), { kind: "ofd" });
  const cfbHeader = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const msg = Uint8Array.from([...cfbHeader, ...Buffer.from("__substg1.0_0037001F", "utf16le")]);
  assert.deepEqual(detectKind(msg, undefined, anydoc), { kind: "message", format: "msg" });
});

test("AVIF and HEIC are told apart by their ftyp brands", () => {
  const ftyp = (major: string, ...compatible: string[]) => {
    const brands = Buffer.from([major, "\0\0\0\0", ...compatible].join(""), "latin1");
    const size = 8 + brands.length;
    return Uint8Array.from([0, 0, 0, size, ...Buffer.from("ftyp"), ...brands]);
  };
  assert.equal(detectImageFormat(ftyp("avif", "mif1", "miaf")), "avif");
  assert.equal(detectImageFormat(ftyp("mif1", "avif", "miaf")), "avif");
  assert.equal(detectImageFormat(ftyp("mif1", "mif1", "heic")), "heic");
  assert.equal(detectImageFormat(ftyp("heic", "mif1")), "heic");
});

test("text saved under a binary Office name is detected by its content", () => {
  const text = (value: string) => Uint8Array.from(Buffer.from(value));
  assert.deepEqual(detectKind(text("<html><body><table></table></body></html>"), "export.xls", anydoc), { kind: "html" });
  assert.deepEqual(detectKind(text("<html><body>report</body></html>"), "report.wps", anydoc), { kind: "html" });
  assert.deepEqual(detectKind(text("name\tqty\nwidgets\t2\n"), "export.xls", anydoc), { kind: "office", format: "csv" });
  assert.deepEqual(detectKind(text("just words"), "letter.doc", anydoc), { kind: "text", format: "plain" });
  assert.deepEqual(detectKind(text("not really a pdf"), "scan.pdf", anydoc), { kind: "text", format: "plain" });
  assert.deepEqual(detectKind(Uint8Array.from([0x01, 0x00, 0x02]), "broken.xls", anydoc), { kind: "office", format: "xlsx" });
});
