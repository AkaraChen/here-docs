import assert from "node:assert/strict";
import { test } from "node:test";
import iconv from "iconv-lite";
import { convert } from "../src/convert.js";
import { fakeDeps } from "./helpers.js";

test("plain text is decoded and passed through unescaped", async () => {
  const bytes = iconv.encode("第一章\r\n\r\n*星号* 和 # 井号\r\n", "gbk");
  const result = await convert(bytes, { filename: "novel.txt", engine: fakeDeps() });
  assert.equal(result.markdown, "第一章\n\n*星号* 和 # 井号\n");
  assert.deepEqual(result.warnings, []);
});

test("Markdown passes through", async () => {
  const result = await convert(Buffer.from("# Title\n\n- a\n- b\n"), { filename: "notes.md", engine: fakeDeps() });
  assert.equal(result.markdown, "# Title\n\n- a\n- b\n");
});

test("unhinted text is plain text, not unknown", async () => {
  const result = await convert(Buffer.from("name,qty\nwidgets,2\n"), { engine: fakeDeps() });
  assert.equal(result.markdown, "name,qty\nwidgets,2\n");
  assert.deepEqual(result.warnings, []);
});

test("CSV in a legacy encoding reaches the table parser as UTF-8", async () => {
  let received = "";
  const engine = fakeDeps({
    anydoc: {
      formatFromBytes: () => null,
      formatFromExtension: (ext) => (ext === "csv" ? "csv" : null),
      async toDocument(bytes) {
        received = Buffer.from(bytes).toString("utf8");
        return { blocks: [], notes: [], assets: [] };
      },
    },
  });
  await convert(iconv.encode("名称,数量\r\n苹果,3\r\n", "gbk"), { filename: "table.csv", engine });
  assert.equal(received, "名称,数量\r\n苹果,3\r\n");
  await convert(Buffer.from("a\tb\n1\t2\n"), { filename: "table.tsv", engine });
  assert.equal(received, "a\tb\n1\t2\n");
});
