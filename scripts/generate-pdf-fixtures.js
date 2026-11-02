// Writes the handcrafted PDFs under test/fixtures/pdf. Each one isolates one routing edge case and has known
// content, so tests against the real engines can assert exactly which pages are extracted and which are OCR'd.
// Regenerate with `node scripts/generate-pdf-fixtures.js` and commit the output.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "test", "fixtures", "pdf");

/** `scripts/fixtures/hello.png` (black "HELLO" on white) as 8-bit gray pixels: the raster text OCR has to read. */
const hello = await sharp(await readFile(join(here, "fixtures", "hello.png")))
  .flatten({ background: "#ffffff" })
  .grayscale()
  .raw()
  .toBuffer({ resolveWithObject: true });

const helloImage = stream(
  `/Type /XObject /Subtype /Image /Width ${hello.info.width} /Height ${hello.info.height} ` +
    "/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",
  deflateSync(hello.data, { level: 9 }),
);

const HELVETICA = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

const fixtures = {
  "text.pdf": () => documentWith([textPage(prose("Alpha")), textPage(prose("Beta"))]),
  "scanned.pdf": () => documentWith([scanPage(), scanPage()]),
  "mixed.pdf": () => documentWith([textPage(prose("Alpha")), scanPage(), textPage(prose("Gamma"))]),
  "short-text-and-scan.pdf": () => documentWith([textPage(["Alpha title page"]), scanPage(), scanPage()]),
  "scan-with-stamp.pdf": () => documentWith([scanPage({ stamp: "Received 2026-01-15" }), scanPage()]),
  "searchable-scan.pdf": () =>
    documentWith([scanPage({ hiddenText: "Scanner layer words" }), scanPage({ hiddenText: "Scanner layer words" })]),
  "scan-with-blank-page.pdf": () => documentWith([scanPage(), blankPage()]),
  "large-scanned-page.pdf": () => documentWith([scanPage({ width: 4800, height: 1200 })]),
  "cjk-predefined-cmap.pdf": () => documentWith([cjkPage("中文测试")]),
  "links.pdf": () => documentWith([linksPage()]),
  "hidden-layer.pdf": buildHiddenLayer,
  "text-with-image.pdf": () => documentWith([figurePage(), logoPage()]),
};

// --- pages -------------------------------------------------------------------------------------------------

/** Body text long enough to count as a text page, with `word` marking which page it came from. */
function prose(word) {
  return [
    `${word} digital page`,
    "This paragraph is set in Helvetica so that the PDF",
    "carries a real text layer for structured extraction.",
    "It should never be sent through OCR.",
  ];
}

/** A page with one line of 12pt Helvetica per entry, top to bottom. */
function textPage(lines, { width = 400, height = 200 } = {}) {
  return { width, height, content: textLines(lines, height - 40), fonts: { F1: HELVETICA } };
}

function textLines(lines, top, { left = 30, leading = 20 } = {}) {
  return lines.map((line, index) => `BT /F1 12 Tf ${left} ${top - index * leading} Td (${escapeText(line)}) Tj ET`).join("\n");
}

/**
 * A scanned page: the HELLO image across the page. `hiddenText` adds an invisible text layer (rendering mode 3)
 * over it, the way scanners and OCR tools make a scan searchable. `stamp` adds a little visible native text in a
 * corner, like a received stamp or a header written onto a scan.
 */
function scanPage({ hiddenText, stamp, width = 400, height = 200 } = {}) {
  let content = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;
  const fonts = {};
  if (hiddenText) {
    content += `\nBT 3 Tr /F1 24 Tf 40 ${height / 2} Td (${escapeText(hiddenText)}) Tj ET`;
    fonts.F1 = HELVETICA;
  }
  if (stamp) {
    content += `\nBT /F1 8 Tf 300 10 Td (${escapeText(stamp)}) Tj ET`;
    fonts.F1 = HELVETICA;
  }
  return { width, height, content, fonts, images: { Im1: helloImage } };
}

function blankPage({ width = 400, height = 200 } = {}) {
  return { width, height, content: "" };
}

/** Chinese text in a non-embedded CID font with a predefined CMap and no /ToUnicode: unreadable as text. */
function cjkPage(text) {
  const hex = [...text].map((char) => char.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()).join("");
  return {
    width: 400,
    height: 200,
    content: `BT /F1 32 Tf 40 100 Td <${hex}> Tj ET`,
    fonts: {
      F1: {
        objects: [
          "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [{1}] >>",
          "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light " +
            "/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor {2} /DW 1000 >>",
          "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] " +
            "/ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>",
        ],
      },
    },
  };
}

/**
 * One sentence per line, each with a link annotation over part of it: an https URL, a mailto URL, a javascript
 * URL that must never become a Markdown link, and an internal jump to the page itself.
 */
function linksPage() {
  const width = 460;
  const height = 220;
  const sentences = [
    ["Read the ", "here-docs repository", " for the details.", "/S /URI /URI (https://github.com/AkaraChen/here-docs)"],
    ["Write to ", "the maintainers", " with questions.", "/S /URI /URI (mailto:maintainers@example.com)"],
    ["This ", "script action", " stays plain text.", "/S /URI /URI (javascript:alert\\(1\\))"],
    ["Jump ", "back to the top", " of this page.", null],
  ];
  const top = height - 40;
  const left = 30;
  const content = textLines(
    sentences.map(([before, anchor, after]) => before + anchor + after),
    top,
    { left },
  );
  return {
    width,
    height,
    content,
    fonts: { F1: HELVETICA },
    extra: (add, pageRef) => {
      const annotations = sentences.map(([before, anchor], index) => {
        const x0 = left + helveticaWidth(before, 12);
        const x1 = x0 + helveticaWidth(anchor, 12);
        const baseline = top - index * 20;
        const action = sentences[index][3];
        const target = action ? `/A << ${action} >>` : `/Dest [${pageRef} /XYZ 0 ${height} 0]`;
        return add(
          `<< /Type /Annot /Subtype /Link /Rect [${x0.toFixed(2)} ${baseline - 3} ${x1.toFixed(2)} ${baseline + 11}] ` +
            `/Border [0 0 0] ${target} >>`,
        );
      });
      return `/Annots [${annotations.join(" ")}]`;
    },
  };
}

/**
 * Visible prose, a line in an optional content group the document shows by default, and a line in one it turns off
 * by default.
 */
function buildHiddenLayer() {
  return documentWith(
    [
      {
        width: 400,
        height: 200,
        content:
          textLines(prose("Visible"), 160) +
          "\n/OC /On BDC\n" +
          textLines(["Shown layer words"], 70) +
          "\nEMC\n/OC /Off BDC\n" +
          textLines(["Hidden layer words"], 45) +
          "\nEMC",
        fonts: { F1: HELVETICA },
        properties: (groups) => ({ On: groups.on, Off: groups.off }),
      },
    ],
    {
      catalog: (add, context) => {
        context.on = add("<< /Type /OCG /Name (Final) >>");
        context.off = add("<< /Type /OCG /Name (Draft notes) >>");
        return (
          `/OCProperties << /OCGs [${context.on} ${context.off}] ` +
          `/D << /Order [${context.on} ${context.off}] /OFF [${context.off}] >> >>`
        );
      },
    },
  );
}

/**
 * Text above and below a figure whose only content is the HELLO raster, so its text exists only as pixels. A page
 * with images needs ten text-showing operators before the classifier counts it as a text page, as real pages with
 * figures do.
 */
function figurePage() {
  const above = ["Figure one shows a scanned greeting.", ...filler(5)];
  const below = ["The paragraph below the figure continues.", ...filler(5)];
  return {
    width: 400,
    height: 400,
    content: [textLines(above, 370, { leading: 16 }), "q 240 0 0 60 80 220 cm /Im1 Do Q", textLines(below, 190, { leading: 16 })].join(
      "\n",
    ),
    fonts: { F1: HELVETICA },
    images: { Im1: helloImage },
  };
}

/** Prose with a logo-sized copy of the HELLO raster in the corner: too small to be worth OCR. */
function logoPage() {
  return {
    width: 400,
    height: 400,
    content: [textLines(["Logo page text.", ...filler(11)], 370, { leading: 16 }), "q 24 0 0 6 360 385 cm /Im1 Do Q"].join("\n"),
    fonts: { F1: HELVETICA },
    images: { Im1: helloImage },
  };
}

function filler(count) {
  return Array.from({ length: count }, (_, index) => `Line ${index + 1} of ordinary body text on this page.`);
}

// --- serialization -----------------------------------------------------------------------------------------

/**
 * Lays out the catalog, the page tree, and every page with its resources, then serializes the objects. A font is
 * either an object body, or `{ objects }` whose bodies reference each other as `{n}` (the n-th of them).
 */
function documentWith(pages, { catalog: catalogExtra } = {}) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return `${objects.length} 0 R`;
  };
  const set = (ref, body) => {
    objects[Number.parseInt(ref, 10) - 1] = body;
  };
  const catalog = add(null);
  const pageTree = add(null);
  const context = {};
  const catalogEntries = catalogExtra ? ` ${catalogExtra(add, context)}` : "";
  const pageRefs = [];

  for (const page of pages) {
    const pageRef = add(null);
    pageRefs.push(pageRef);
    const resources = [];

    const fonts = Object.entries(page.fonts ?? {}).map(([name, font]) => `/${name} ${addFont(font, add, set)}`);
    if (fonts.length > 0) {
      resources.push(`/Font << ${fonts.join(" ")} >>`);
    }
    const images = Object.entries(page.images ?? {}).map(([name, image]) => `/${name} ${add(image)}`);
    if (images.length > 0) {
      resources.push(`/XObject << ${images.join(" ")} >>`);
    }
    if (page.properties) {
      const entries = Object.entries(page.properties(context)).map(([name, ref]) => `/${name} ${ref}`);
      resources.push(`/Properties << ${entries.join(" ")} >>`);
    }
    const contents = add(stream("", Buffer.from(page.content, "latin1")));
    const extra = page.extra ? ` ${page.extra(add, pageRef)}` : "";

    set(
      pageRef,
      `<< /Type /Page /Parent ${pageTree} /MediaBox [0 0 ${page.width} ${page.height}] ` +
        `/Resources << ${resources.join(" ")} >> /Contents ${contents}${extra} >>`,
    );
  }

  set(catalog, `<< /Type /Catalog /Pages ${pageTree}${catalogEntries} >>`);
  set(pageTree, `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`);
  return serialize(objects);
}

function addFont(font, add, set) {
  if (typeof font === "string") {
    return add(font);
  }
  // Reserve the font's objects first so their bodies can reference each other by position.
  const refs = font.objects.map(() => add(null));
  font.objects.forEach((body, index) => {
    set(refs[index], body.replace(/\{(\d+)\}/g, (_, n) => refs[Number(n)]));
  });
  return refs[0];
}

function stream(dictionary, data) {
  return { dictionary, data };
}

function serialize(objects) {
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = (chunk) => {
    chunks.push(chunk);
    length += chunk.length;
  };

  push(Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"));
  objects.forEach((body, index) => {
    offsets.push(length);
    push(Buffer.from(`${index + 1} 0 obj\n`, "latin1"));
    if (typeof body === "string") {
      push(Buffer.from(`${body}\n`, "latin1"));
    } else {
      push(Buffer.from(`<< ${body.dictionary} /Length ${body.data.length} >>\nstream\n`, "latin1"));
      push(body.data);
      push(Buffer.from("\nendstream\n", "latin1"));
    }
    push(Buffer.from("endobj\n", "latin1"));
  });

  const xref = length;
  push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(chunks);
}

function escapeText(text) {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

/** Helvetica advance widths (1/1000 em) for printable ASCII, from the standard 14 font metrics. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];

function helveticaWidth(text, size) {
  let units = 0;
  for (const char of text) {
    units += HELVETICA_WIDTHS[char.charCodeAt(0) - 32] ?? 556;
  }
  return (units * size) / 1000;
}

await mkdir(outDir, { recursive: true });
for (const [name, build] of Object.entries(fixtures)) {
  await writeFile(join(outDir, name), build());
}
console.log(`wrote ${Object.keys(fixtures).length} fixtures to ${outDir}`);
