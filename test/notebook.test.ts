import assert from "node:assert/strict";
import { test } from "node:test";
import { convert } from "../src/convert.js";
import { WarningCode } from "../src/errors.js";
import { fakeDeps, labelledPng, labelOcr } from "./helpers.js";

test("notebook cells and outputs become Markdown", async () => {
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { language: "python", name: "python3" } },
    cells: [
      { cell_type: "markdown", metadata: {}, source: ["# Analysis\n", "Some *notes*."] },
      {
        cell_type: "code",
        metadata: {},
        source: ["print('```')\n", "df"],
        outputs: [
          { output_type: "stream", name: "stdout", text: ["\u001b[31mloaded\u001b[0m 3 rows\n"] },
          { output_type: "execute_result", data: { "text/plain": ["  a"], "text/html": ["<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>"] } },
          { output_type: "display_data", data: { "image/png": Buffer.from(labelledPng("PLOT")).toString("base64"), "text/plain": ["<Figure>"] } },
          { output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["\u001b[0;31mValueError\u001b[0m: bad"] },
        ],
      },
      { cell_type: "raw", metadata: {}, source: "raw text" },
    ],
  };
  const result = await convert(Buffer.from(JSON.stringify(notebook)), { engine: fakeDeps({ ocr: labelOcr() }) });
  assert.equal(
    result.markdown,
    [
      "# Analysis",
      "Some *notes*.",
      "",
      "````python",
      "print('```')",
      "df",
      "````",
      "",
      "```",
      "loaded 3 rows",
      "```",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "PLOT",
      "",
      "```",
      "ValueError: bad",
      "```",
      "",
      "```",
      "raw text",
      "```",
      "",
    ].join("\n"),
  );
  assert.deepEqual(result.warnings, []);
});

test("a notebook that is not JSON is a warning", async () => {
  const result = await convert(Buffer.from('{"nbformat": 4, "cells": ['), { filename: "broken.ipynb", engine: fakeDeps() });
  assert.equal(result.markdown, "");
  assert.equal(result.warnings[0]?.code, WarningCode.malformed);
});

test("old notebooks with worksheets and newline-less source lines keep their lines", async () => {
  const notebook = {
    nbformat: 3,
    metadata: { language: "python" },
    worksheets: [
      {
        cells: [
          { cell_type: "heading", level: 2, source: ["Old format"] },
          { cell_type: "markdown", source: ["first line", "second line"] },
          { cell_type: "code", language: "python", input: ["a = 1", "print(a)"], outputs: [{ output_type: "stream", text: ["1\n"] }] },
        ],
      },
    ],
  };
  const result = await convert(Buffer.from(JSON.stringify(notebook)), { filename: "old.ipynb", engine: fakeDeps() });
  assert.equal(result.markdown, "## Old format\n\nfirst line\nsecond line\n\n```python\na = 1\nprint(a)\n```\n\n```\n1\n```\n");
});
