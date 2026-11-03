import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { convert } from "../src/convert.js";
import { svgItems } from "../src/svg.js";
import { fakeDeps, labelledPng, labelOcr } from "./helpers.js";

const texts = (svg: string | Uint8Array) =>
  svgItems(typeof svg === "string" ? Buffer.from(svg) : svg)
    .filter((item) => item.kind === "text")
    .map((item) => (item.kind === "text" ? item.text : ""));

test("SVG text: lines per text element and positioned tspan; hidden and descriptive text skipped", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><title>Tooltip</title><defs><text id="t">template</text></defs>
    <text x="0" y="10">Hello <tspan font-weight="bold">bold</tspan> world</text>
    <text><tspan x="0" y="20">first</tspan><tspan x="0" dy="1.2em">second</tspan></text>
    <g display="none"><text>hidden</text></g><text>我能吞下玻璃而不伤身体</text></svg>`;
  assert.deepEqual(texts(svg), ["Hello bold world", "first", "second", "我能吞下玻璃而不伤身体"]);
});

test("SVG labels in foreignObject (Mermaid, draw.io) are read; a switch renders its first child", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g class="node"><foreignObject width="100" height="20">
    <div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>Meta schedules GC</p></span></div></foreignObject></g>
    <switch><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Pick regions<br/>by size</div></foreignObject><text>Pick regi...</text></switch>
    <switch><g requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility"/><a><text>Text is not SVG - cannot display</text></a></switch></svg>`;
  assert.deepEqual(texts(svg), ["Meta schedules GC", "Pick regions", "by size"]);
});

test("SVGZ is read, and embedded raster images are OCR'd in document order", async () => {
  const png = Buffer.from(labelledPng("EMBEDDED")).toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><text>Before</text>
    <image xlink:href="data:image/png;base64,${png}"/><text>After</text></svg>`;
  const result = await convert(gzipSync(Buffer.from(svg)), { filename: "drawing.svgz", engine: fakeDeps({ ocr: labelOcr() }) });
  assert.equal(result.markdown, "Before\nEMBEDDED\nAfter\n");
});

test("an SVG without text is rendered and OCR'd", async () => {
  let rendered = 0;
  const engine = fakeDeps({
    images: {
      async toPng() {
        rendered += 1;
        return labelledPng("RENDERED");
      },
    },
    ocr: labelOcr(),
  });
  const result = await convert(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'), { engine });
  assert.equal(rendered, 1);
  assert.equal(result.markdown, "RENDERED\n");
});

test("language variants are read as an English renderer shows them", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><switch><g systemLanguage="ja"><text>料理人</text></g>
    <g systemLanguage="en-US,en"><text>Cook</text></g><g><text>default</text></g></switch>
    <text systemLanguage="tl">Hindi</text><text>Always</text></svg>`;
  assert.deepEqual(texts(svg), ["Cook", "Always"]);
});
