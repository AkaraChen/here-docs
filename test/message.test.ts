import assert from "node:assert/strict";
import { test } from "node:test";
import CFB from "cfb";
import iconv from "iconv-lite";
import { convert, MAX_ATTACHMENT_DEPTH } from "../src/convert.js";
import { WarningCode } from "../src/errors.js";
import { fakeDeps, labelledPng, labelOcr, pdfBytes } from "./helpers.js";

const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64");

function eml(headers: string[], parts: string[], boundary = "mix"): string {
  return [...headers, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts.flatMap((part) => [`--${boundary}`, part]), `--${boundary}--`, ""].join("\r\n");
}

function attachment(name: string, type: string, content: Uint8Array | string): string {
  return [`Content-Type: ${type}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, "Content-Transfer-Encoding: base64", "", b64(content)].join("\r\n");
}

const htmlWithInlineImage = [
  'Content-Type: multipart/related; boundary="rel"',
  "",
  "--rel",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<html><body><p>See <b>chart</b>:</p><img src="cid:chart@x"><table role="presentation"><tr><td>Thanks,<br>Alice</td></tr></table></body></html>',
  "--rel",
  "Content-Type: image/png",
  "Content-ID: <chart@x>",
  "Content-Disposition: inline",
  "Content-Transfer-Encoding: base64",
  "",
  b64(labelledPng("CHART")),
  "--rel--",
].join("\r\n");

test("an e-mail renders headers, body with inline images in place, and converted attachments", async () => {
  const bytes = Buffer.from(
    eml(
      ["From: Alice Example <alice@example.com>", "To: Bob <bob@example.com>, carol@example.com", "Cc: dave@example.com", "Subject: =?UTF-8?B?5Lya6K6u?= notes", "Date: Mon, 2 Nov 2026 10:00:00 +0800"],
      [htmlWithInlineImage, attachment("report.pdf", "application/pdf", pdfBytes), attachment("data.csv", "text/csv", iconv.encode("名称\n苹果\n", "gbk"))],
    ),
  );
  const ocr = labelOcr();
  const engine = fakeDeps({
    ocr,
    anydoc: {
      formatFromBytes: () => null,
      formatFromExtension: (ext) => (ext === "csv" ? "csv" : null),
      async toDocument(csv) {
        return { blocks: [{ kind: "paragraph", content: [{ kind: "text", text: Buffer.from(csv).toString() }] }], notes: [], assets: [] };
      },
    },
  });
  const result = await convert(bytes, { filename: "mail.eml", engine });
  assert.equal(
    result.markdown,
    [
      "# 会议 notes",
      "",
      "- **From:** Alice Example <alice@example.com>",
      "- **To:** Bob <bob@example.com>, carol@example.com",
      "- **Cc:** dave@example.com",
      "- **Date:** 2026-11-02T02:00:00.000Z",
      "",
      "See **chart**:",
      "",
      "CHART",
      "",
      "Thanks,\\",
      "Alice",
      "",
      "## Attachments",
      "",
      "### report.pdf",
      "",
      "# From PDF",
      "",
      "### data.csv",
      "",
      "名称\n苹果",
      "",
    ].join("\n"),
  );
  assert.deepEqual(ocr.encoded, ["CHART"]);
  assert.deepEqual(result.warnings, []);
});

test("signature parts of signed mail are not listed as attachments", async () => {
  const bytes = Buffer.from(eml(["From: a@example.com", "To: b@example.com", "Subject: signed"], ["Content-Type: text/plain\r\n\r\nSigned body.", attachment("smime.p7s", "application/pkcs7-signature", Uint8Array.from([0x30, 0x82, 0x00, 0x01]))]));
  const result = await convert(bytes, { engine: fakeDeps() });
  assert.doesNotMatch(result.markdown, /Attachments|smime/);
  assert.deepEqual(result.warnings, []);
});

test("unconvertible attachments keep their heading and add a named warning", async () => {
  const bytes = Buffer.from(eml(["From: a@example.com", "To: b@example.com", "Subject: zip"], ["Content-Type: text/plain\r\n\r\nSee attached.", attachment("files.zip", "application/zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))]));
  const result = await convert(bytes, { engine: fakeDeps() });
  assert.match(result.markdown, /See attached\.\n\n## Attachments\n\n### files\.zip\n$/);
  assert.equal(result.warnings[0]?.code, WarningCode.unknownType);
  assert.match(result.warnings[0]?.message ?? "", /^attachment "files\.zip": /);
});

test("attached messages are converted recursively up to the nesting limit", async () => {
  let message = eml(["From: a@example.com", "To: b@example.com", "Subject: level 4"], ["Content-Type: text/plain\r\n\r\ninnermost"]);
  for (let level = 3; level >= 0; level -= 1) {
    message = eml(
      ["From: a@example.com", "To: b@example.com", `Subject: level ${level}`],
      ["Content-Type: text/plain\r\n\r\nbody", ["Content-Type: message/rfc822", "Content-Disposition: attachment", "", message].join("\r\n")],
      `b${level}`,
    );
  }
  const result = await convert(Buffer.from(message), { engine: fakeDeps() });
  for (let level = 0; level <= MAX_ATTACHMENT_DEPTH; level += 1) {
    assert.match(result.markdown, new RegExp(`# level ${level}\\n`));
  }
  assert.doesNotMatch(result.markdown, /level 4|innermost/);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.code, WarningCode.resourceLimit);
});

test("a web archive renders its page and OCRs archived images by location", async () => {
  const bytes = Buffer.from(
    [
      "From: <Saved by Blink>",
      "Snapshot-Content-Location: https://example.com/docs/page.html",
      "Subject: Page",
      'Content-Type: multipart/related; type="text/html"; boundary="B"',
      "",
      "--B",
      "Content-Type: text/html",
      "Content-Transfer-Encoding: quoted-printable",
      "Content-Location: https://example.com/docs/page.html",
      "",
      '<html><body><h1>Archived =E4=B8=AD=E6=96=87</h1><img src=3D"img/fig.png"><img src=3D"https://cdn.example/missing.png"></body></html>',
      "--B",
      "Content-Type: image/png",
      "Content-Transfer-Encoding: base64",
      "Content-Location: https://example.com/docs/img/fig.png",
      "",
      b64(labelledPng("FIGURE")),
      "--B--",
      "",
    ].join("\r\n"),
  );
  const result = await convert(bytes, { engine: fakeDeps({ ocr: labelOcr() }) });
  assert.equal(result.markdown, "# Archived 中文\n\nFIGURE\n");
});

function msgBytes(build: (cfb: CFB.CFB$Container, add: (path: string, value: string | Uint8Array) => void) => void): Uint8Array {
  const cfb = CFB.utils.cfb_new();
  const add = (path: string, value: string | Uint8Array) =>
    CFB.utils.cfb_add(cfb, path, typeof value === "string" ? Buffer.from(value, "utf16le") : Buffer.from(value));
  build(cfb, add);
  CFB.utils.cfb_del(cfb, "/\u0001Sh33tJ5");
  return new Uint8Array(CFB.write(cfb, { type: "buffer" }) as Buffer);
}

test("an Outlook message renders headers, body, and attachments including an embedded message", async () => {
  const bytes = msgBytes((_cfb, add) => {
    add("/__properties_version1.0", new Uint8Array(32));
    add("/__substg1.0_0037001F", "Quarterly numbers");
    add("/__substg1.0_0C1A001F", "Alice");
    add("/__substg1.0_5D01001F", "alice@example.com");
    add("/__substg1.0_1000001F", "Hello Bob,\r\nnumbers attached.\r\n");
    add("/__recip_version1.0_#00000000/__properties_version1.0", new Uint8Array(8));
    add("/__recip_version1.0_#00000000/__substg1.0_3001001F", "Bob");
    add("/__recip_version1.0_#00000000/__substg1.0_39FE001F", "bob@example.com");
    add("/__attach_version1.0_#00000000/__properties_version1.0", new Uint8Array(8));
    add("/__attach_version1.0_#00000000/__substg1.0_3707001F", "notes.txt");
    add("/__attach_version1.0_#00000000/__substg1.0_37010102", Buffer.from("attached notes"));
    add("/__attach_version1.0_#00000001/__properties_version1.0", new Uint8Array(8));
    add("/__attach_version1.0_#00000001/__substg1.0_3001001F", "Inner");
    add("/__attach_version1.0_#00000001/__substg1.0_3701000D/__properties_version1.0", new Uint8Array(24));
    add("/__attach_version1.0_#00000001/__substg1.0_3701000D/__substg1.0_0037001F", "Inner");
    add("/__attach_version1.0_#00000001/__substg1.0_3701000D/__substg1.0_1000001F", "inner body");
  });
  const result = await convert(bytes, { filename: "mail.msg", engine: fakeDeps() });
  assert.equal(
    result.markdown,
    [
      "# Quarterly numbers",
      "",
      "- **From:** Alice <alice@example.com>",
      "- **To:** Bob <bob@example.com>",
      "",
      "Hello Bob,",
      "numbers attached.",
      "",
      "## Attachments",
      "",
      "### notes.txt",
      "",
      "attached notes",
      "",
      "### Inner.msg",
      "",
      "# Inner",
      "",
      "inner body",
      "",
    ].join("\n"),
  );
  assert.deepEqual(result.warnings, []);
});

test("a broken message is a warning, not a throw", async () => {
  const cfbHeader = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const bytes = Uint8Array.from([...cfbHeader, ...Buffer.from("__substg1.0_0037001F", "utf16le")]);
  const result = await convert(bytes, { engine: fakeDeps() });
  assert.equal(result.markdown, "");
  assert.equal(result.warnings[0]?.code, WarningCode.malformed);
});

test("raw 8-bit headers and headers folded without indentation are decoded", async () => {
  const subject = iconv.encode("[주말특가] 핫팩", "euc-kr");
  const head = Buffer.concat([
    Buffer.from("From: shop@example.com\r\nTo: a@example.com\r\nSubject: "),
    subject,
    Buffer.from('\r\nX-Note: =?utf-8?B?5pel5pys?=\r\n=?utf-8?B?6Kqe?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset="euc-kr"\r\n\r\n'),
    iconv.encode("본문입니다", "euc-kr"),
  ]);
  const result = await convert(head, { filename: "mail.eml", engine: fakeDeps() });
  assert.match(result.markdown, /^# \\\[주말특가\\\] 핫팩\n/);
  assert.match(result.markdown, /본문입니다\n$/);
  assert.doesNotMatch(result.markdown, /MIME-Version/);
});
