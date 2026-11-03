import { readFile, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const helloPng = await readFile(join(here, "fixtures", "hello.png"));
const helloPdf = Buffer.from(`%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 51 >>stream
BT /F1 24 Tf 50 100 Td (HELLO PDF) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000367 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
447
%%EOF
`);
const csvBytes = Buffer.from("name,qty\nwidgets,2\n");

function fail(message, result) {
  throw new Error(`${message}: ${JSON.stringify(result)}`);
}

function assertUsable(result, label) {
  if (typeof result.markdown !== "string") {
    fail(`${label} did not return markdown`, result);
  }
  if (result.warnings.some((warning) => String(warning.message).includes("Engine is closed"))) {
    fail(`${label} closed the engine early`, result);
  }
  if (result.warnings.some((warning) => /platform package|omit=optional/i.test(warning.message))) {
    fail(`${label} treated a missing native as a warning`, result);
  }
}

/** Formats parsed in JavaScript, plus the image paths that need sharp's decoders (SVG, AVIF, TIFF pages). */
async function convertNewFormats(convert, engine) {
  const { default: sharp } = await import("sharp");
  const helloSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140"><rect width="100%" height="100%" fill="white"/>' +
      '<text x="24" y="96" font-family="sans-serif" font-size="64">HELLO</text></svg>',
  );
  const pngDataUri = `data:image/png;base64,${helloPng.toString("base64")}`;
  // "第一章 你好" in GBK.
  const gbkText = Buffer.from("b5dad2bbd5c220c4e3bac30a", "hex");
  const eml = [
    "From: Alice <alice@example.com>",
    "To: bob@example.com",
    "Subject: Smoke",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/html; charset=utf-8",
    "",
    `<p>Body <img src="${pngDataUri}"></p>`,
    "--b",
    'Content-Type: application/pdf; name="hello.pdf"',
    'Content-Disposition: attachment; filename="hello.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    helloPdf.toString("base64"),
    "--b--",
    "",
  ].join("\r\n");
  const tiffPages = await sharp([helloPng, helloPng], { join: { animated: true } }).tiff().toBuffer();
  const checks = [
    ["html", Buffer.from(`<!doctype html><h1>Title</h1><p>See <img src="${pngDataUri}"></p>`), "page.html", /# Title[\s\S]*HELLO/i],
    ["eml", Buffer.from(eml), "mail.eml", /# Smoke[\s\S]*HELLO[\s\S]*### hello\.pdf[\s\S]*HELLO PDF/i],
    ["text", gbkText, "novel.txt", /第一章 你好/],
    ["svg", helloSvg, "hello.svg", /HELLO/i],
    ["avif", await sharp(helloPng).avif().toBuffer(), "hello.avif", /HELLO/i],
    ["tiff", tiffPages, "pages.tiff", /## Page 1[\s\S]*HELLO[\s\S]*## Page 2[\s\S]*HELLO/i],
  ];
  const out = {};
  for (const [label, bytes, filename, expected] of checks) {
    const result = await convert(bytes, { filename, engine });
    assertUsable(result, label);
    if (!expected.test(result.markdown) || result.warnings.length > 0) {
      fail(`${label} did not convert`, result);
    }
    out[label] = result.markdown.trim();
  }
  return out;
}

async function loadApi() {
  if (process.env.HERE_DOCS_SMOKE_PACKAGE) {
    return import("here-docs");
  }
  return import(pathToFileURL(join(here, "..", "dist", "index.js")).href);
}

const { convert, createEngine } = await loadApi();
const engine = await createEngine();
try {
  const image = await convert(helloPng, { filename: "hello.png", engine });
  assertUsable(image, "image");
  if (!/HELLO/i.test(image.markdown)) {
    fail("image OCR did not read HELLO", image);
  }

  const pdf = await convert(helloPdf, { filename: "hello.pdf", engine });
  assertUsable(pdf, "pdf");
  if (!/HELLO/.test(pdf.markdown)) {
    fail("pdf-inspector did not extract HELLO", pdf);
  }

  const csv = await convert(csvBytes, { filename: "items.csv", engine });
  assertUsable(csv, "csv");
  if (!/widgets/i.test(csv.markdown)) {
    fail("anydoc did not convert CSV", csv);
  }

  const formats = await convertNewFormats(convert, engine);

  console.log(
    JSON.stringify(
      {
        image: image.markdown.trim(),
        pdf: pdf.markdown.trim(),
        csv: csv.markdown.trim(),
        ...formats,
      },
      null,
      2,
    ),
  );
} finally {
  await engine.close();
}

const tmpPng = join(process.cwd(), "hello.smoke.png");
const cliJs = process.env.HERE_DOCS_SMOKE_PACKAGE
  ? join(process.cwd(), "node_modules", "here-docs", "dist", "cli.js")
  : join(here, "..", "dist", "cli.js");
await writeFile(tmpPng, helloPng);
try {
  const ran = spawnSync(process.execPath, [cliJs, tmpPng, "--json"], { encoding: "utf8" });
  if (ran.status !== 0) {
    throw new Error(`CLI smoke failed (${ran.status}): ${ran.stderr || ran.stdout}`);
  }
  const parsed = JSON.parse(ran.stdout);
  assertUsable(parsed, "cli");
  if (!/HELLO/i.test(parsed.markdown)) {
    fail("CLI OCR did not read HELLO", parsed);
  }
} finally {
  await unlink(tmpPng).catch(() => {});
}

console.log("SMOKE_OK");
