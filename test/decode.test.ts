import assert from "node:assert/strict";
import { test } from "node:test";
import iconv from "iconv-lite";
import { decodeText, sniffText, toUtf8 } from "../src/text/decode.js";

test("a BOM decides the encoding", () => {
  const utf16 = Uint8Array.from([0xff, 0xfe, ...iconv.encode("名称", "utf16le")]);
  assert.deepEqual(decodeText(utf16), { text: "名称", encoding: "utf-16le" });
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))?.text, "a");
});

test("legacy CJK encodings are detected, including short inputs", () => {
  const cases: Array<[string, string]> = [
    ["名称,数量\n苹果,3\n", "gbk"],
    ["第一章 开端\n这是一个用GBK编码保存的网络小说片段，用来测试编码检测。\n", "gbk"],
    ["名稱,數量\n蘋果,3\n", "big5"],
    ["이름,나이\n홍길동,30\n", "euc-kr"],
    ["品名,価格\nりんご,100\n", "shift_jis"],
  ];
  for (const [text, encoding] of cases) {
    assert.equal(decodeText(iconv.encode(text, encoding))?.text, text, encoding);
  }
});

test("a declared charset is used when the bytes are not UTF-8", () => {
  const bytes = iconv.encode("Größe", "windows-1252");
  assert.equal(decodeText(bytes, "windows-1252")?.text, "Größe");
  assert.equal(decodeText(iconv.encode("中文", "gbk"), "gb2312")?.text, "中文");
});

test("binary bytes are not text", () => {
  assert.equal(decodeText(Uint8Array.from([0, 1, 2, 3])), null);
  assert.equal(sniffText(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])), null);
});

test("sniffing a prefix tolerates a multi-byte character cut at the boundary", () => {
  const text = "中".repeat(30_000);
  const sniffed = sniffText(Buffer.from(text));
  assert.ok(sniffed?.startsWith("中中中"));
});

test("toUtf8 re-encodes legacy text and leaves UTF-8 alone", () => {
  const utf8 = Buffer.from("a,b\n");
  assert.equal(toUtf8(utf8), utf8);
  assert.equal(Buffer.from(toUtf8(iconv.encode("名称,数量\n苹果,3\n", "gbk"))).toString(), "名称,数量\n苹果,3\n");
  assert.equal(Buffer.from(toUtf8(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))).toString(), "a");
});

test("valid UTF-8 wins over a wrong declared charset", () => {
  assert.equal(decodeText(Buffer.from("标题"), "gbk")?.text, "标题");
});

test("UTF-16 without a BOM is recognized from its NUL bytes", () => {
  const text = "日本語のテキスト\u3000UTF-16 without BOM\r\n二行目";
  assert.equal(decodeText(Buffer.from(text, "utf16le"))?.text, text);
  assert.equal(decodeText(Buffer.from(text, "utf16le").swap16())?.text, text);
  assert.equal(decodeText(Uint8Array.from([0x00, 0x01, 0x00, 0x02, 0x00, 0x03])), null);
});

test("ISO-2022-JP is decoded although it is valid ASCII", () => {
  const bytes = Buffer.from("1b244224332473244b2441244f2122402433261b2842", "hex");
  assert.equal(decodeText(bytes)?.text, "こんにちは、世界");
});

test("Latin-1 accents next to ASCII are not taken for CJK", () => {
  const text = "Code_postal;Libellé_d_acheminement;Ligne_5\n01400;L ABERGEMENT;\n";
  assert.equal(decodeText(iconv.encode(text, "latin1"))?.text, text);
});
