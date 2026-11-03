import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { convert, convertPages } from "../src/convert.js";
import { WarningCode } from "../src/errors.js";
import type { ConvertPart } from "../src/types.js";
import { fakeDeps, labelledPng, labelOcr } from "./helpers.js";

const NS = 'xmlns:ofd="http://www.ofdspec.org/2016"';

function text(id: number, boundary: string, value: string, extra = ""): string {
  return `<ofd:TextObject ID="${id}" Boundary="${boundary}" Font="1" Size="3.5"${extra}><ofd:TextCode X="0" Y="3">${value}</ofd:TextCode></ofd:TextObject>`;
}

function page(content: string, template = ""): Uint8Array {
  return strToU8(`<?xml version="1.0" encoding="UTF-8"?><ofd:Page ${NS}>${template}<ofd:Content><ofd:Layer ID="1">${content}</ofd:Layer></ofd:Content></ofd:Page>`);
}

/** An invoice-like page whose values come before its labels in the file, plus a scanned page. */
function sampleOfd(): Uint8Array {
  return zipSync({
    "OFD.xml": strToU8(`<?xml version="1.0"?><ofd:OFD ${NS}><ofd:DocBody><ofd:DocRoot>Doc_0/Document.xml</ofd:DocRoot></ofd:DocBody></ofd:OFD>`),
    "Doc_0/Document.xml": strToU8(
      `<?xml version="1.0"?><ofd:Document ${NS}><ofd:CommonData><ofd:DocumentRes>DocumentRes.xml</ofd:DocumentRes><ofd:TemplatePage ID="9" BaseLoc="Tpls/Tpl_0/Content.xml"/></ofd:CommonData>` +
        `<ofd:Pages><ofd:Page ID="1" BaseLoc="Pages/Page_0/Content.xml"/><ofd:Page ID="2" BaseLoc="/Doc_0/pages/page_1/content.xml"/></ofd:Pages></ofd:Document>`,
    ),
    "Doc_0/DocumentRes.xml": strToU8(
      `<?xml version="1.0"?><ofd:Res ${NS} BaseLoc="Res"><ofd:MultiMedias><ofd:MultiMedia ID="7" Type="Image"><ofd:MediaFile>scan.png</ofd:MediaFile></ofd:MultiMedia></ofd:MultiMedias></ofd:Res>`,
    ),
    "Doc_0/Tpls/Tpl_0/Content.xml": page(text(1, "10 20 30 5", "金额：") + text(2, "10 10 30 5", "发票号码：")),
    "Doc_0/Pages/Page_0/Content.xml": page(
      text(3, "40 10 40 5", "12345") + text(4, "40 20 40 5", "¥100.00") + text(5, "40 20 40 5", "¥100.00") + text(6, "10 40 80 5", "合计", ' CTM="2 0 0 2 0 0"'),
      '<ofd:Template TemplateID="9" ZOrder="Background"/>',
    ),
    "Doc_0/Pages/Page_1/Content.xml": page('<ofd:ImageObject ID="8" ResourceID="7" Boundary="0 0 210 297"/>'),
    "Doc_0/Res/scan.png": labelledPng("SCANNED PAGE"),
  });
}

test("OFD pages yield text in reading order, including template text", async () => {
  const parts: ConvertPart[] = [];
  for await (const part of convertPages(sampleOfd(), { engine: fakeDeps({ ocr: labelOcr() }) })) {
    parts.push(part);
  }
  assert.deepEqual(
    parts.map((part) => [part.page, part.pageCount]),
    [
      [1, 2],
      [2, 2],
    ],
  );
  assert.equal(parts[0]?.markdown, "发票号码： 12345\n金额： ¥100.00\n合计");
  assert.equal(parts[1]?.markdown, "## Page 2\n\nSCANNED PAGE");
});

test("stopping after the first OFD page does no OCR", async () => {
  const ocr = labelOcr();
  for await (const part of convertPages(sampleOfd(), { engine: fakeDeps({ ocr }) })) {
    assert.equal(part.page, 1);
    break;
  }
  assert.deepEqual(ocr.encoded, []);
});

test("an OFD without its root part is a warning", async () => {
  const bytes = zipSync({ "OFD.xml": strToU8(`<ofd:OFD ${NS}/>`) });
  const result = await convert(bytes, { engine: fakeDeps() });
  assert.equal(result.markdown, "");
  assert.equal(result.warnings[0]?.code, WarningCode.malformed);
});

test("an OFD with data before the ZIP archive (self-extracting, signed) still opens", async () => {
  const prefixed = Uint8Array.from([...Buffer.from("SFX-STUB".repeat(10)), ...sampleOfd()]);
  const parts: ConvertPart[] = [];
  for await (const part of convertPages(prefixed, { engine: fakeDeps({ ocr: labelOcr() }) })) {
    parts.push(part);
  }
  assert.equal(parts[0]?.markdown, "发票号码： 12345\n金额： ¥100.00\n合计");
});

test("text inside composite graphic units is placed through the unit's matrix", async () => {
  const bytes = zipSync({
    "OFD.xml": strToU8(`<ofd:OFD ${NS}><ofd:DocBody><ofd:DocRoot>Doc_0/Document.xml</ofd:DocRoot></ofd:DocBody></ofd:OFD>`),
    "Doc_0/Document.xml": strToU8(
      `<ofd:Document ${NS}><ofd:CommonData><ofd:DocumentRes>DocumentRes.xml</ofd:DocumentRes></ofd:CommonData><ofd:Pages><ofd:Page ID="1" BaseLoc="Pages/Page_0/Content.xml"/></ofd:Pages></ofd:Document>`,
    ),
    "Doc_0/DocumentRes.xml": strToU8(
      `<ofd:Res ${NS} BaseLoc="Res"><ofd:CompositeGraphicUnits><ofd:CompositeGraphicUnit ID="5" Width="200" Height="100"><ofd:Content>` +
        text(1, "0 40 100 10", "second line") +
        text(2, "0 10 100 10", "first line") +
        `</ofd:Content></ofd:CompositeGraphicUnit></ofd:CompositeGraphicUnits></ofd:Res>`,
    ),
    "Doc_0/Pages/Page_0/Content.xml": page(`<ofd:CompositeObject ID="9" ResourceID="5" Boundary="10 10 100 50" CTM="0.5 0 0 0.5 0 0"/>` + text(3, "10 80 50 5", "page text")),
  });
  const result = await convert(bytes, { engine: fakeDeps() });
  assert.equal(result.markdown, "first line\nsecond line\npage text\n");
});
