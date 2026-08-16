import assert from "node:assert/strict";
import { test } from "node:test";
import { documentToMarkdown } from "../src/markdown/from-document.js";
import type { AnydocDocument, AnydocStyle } from "../src/types.js";

const plain: AnydocStyle = { bold: false, italic: false, strike: false, code: false };

test("replaces an embedded image with OCR at the original position", () => {
  const document: AnydocDocument = {
    blocks: [
      {
        kind: "heading",
        level: 1,
        content: [{ kind: "text", text: "Title", style: plain }],
      },
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "before ", style: plain },
          { kind: "image", alt: "chart", source: { kind: "asset", assetId: 0 } },
          { kind: "text", text: " after", style: plain },
        ],
      },
    ],
    notes: [],
    assets: [],
  };
  const markdown = documentToMarkdown(document, new Map([[0, "RECOGNIZED"]]));
  assert.equal(markdown, "# Title\n\nbefore RECOGNIZED after\n");
});

test("keeps alt text when OCR is missing", () => {
  const document: AnydocDocument = {
    blocks: [
      {
        kind: "paragraph",
        content: [{ kind: "image", alt: "logo", source: { kind: "asset", assetId: 2 } }],
      },
    ],
    notes: [],
    assets: [],
  };
  assert.equal(documentToMarkdown(document, new Map()), "logo\n");
});

test("renders lists, tables, and footnotes", () => {
  const document: AnydocDocument = {
    blocks: [
      {
        kind: "list",
        list: {
          marker: "decimal",
          start: 1,
          items: [
            {
              blocks: [
                {
                  kind: "paragraph",
                  content: [{ kind: "text", text: "one", style: plain }],
                },
              ],
            },
          ],
        },
      },
      {
        kind: "table",
        table: {
          kind: "data",
          headerRows: 1,
          grid: [
            [{ kind: "origin", cell: { blocks: [{ kind: "paragraph", content: [{ kind: "text", text: "H", style: plain }] }], colSpan: 1, rowSpan: 1 } }],
            [{ kind: "origin", cell: { blocks: [{ kind: "paragraph", content: [{ kind: "text", text: "C", style: plain }] }], colSpan: 1, rowSpan: 1 } }],
          ],
        },
      },
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "see", style: plain },
          { kind: "noteRef", noteId: "n1" },
        ],
      },
    ],
    notes: [
      {
        id: "n1",
        kind: "footnote",
        blocks: [{ kind: "paragraph", content: [{ kind: "text", text: "note", style: plain }] }],
      },
    ],
    assets: [],
  };
  const markdown = documentToMarkdown(document, new Map());
  assert.match(markdown, /1\. one/);
  assert.match(markdown, /\| H \|/);
  assert.match(markdown, /\| C \|/);
  assert.match(markdown, /see\[\^1\]/);
  assert.match(markdown, /\[\^1\]: note/);
});
