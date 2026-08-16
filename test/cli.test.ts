import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { runCli, type CliIo } from "../src/cli.js";
import { jpegBytes } from "./helpers.js";

function io(overrides: Partial<CliIo> = {}): CliIo & { stdoutBuf: string; stderrBuf: string; written: Map<string, string> } {
  let stdoutBuf = "";
  let stderrBuf = "";
  const written = new Map<string, string>();
  const base: CliIo & { stdoutBuf: string; stderrBuf: string; written: Map<string, string> } = {
    stdin: Readable.from([]),
    stdout: {
      write(chunk: string) {
        stdoutBuf += chunk;
      },
    },
    stderr: {
      write(chunk: string) {
        stderrBuf += chunk;
      },
    },
    stdinIsTTY: true,
    async readFile() {
      return jpegBytes;
    },
    async writeFile(path, data) {
      written.set(path, data);
    },
    async convert() {
      return { markdown: "# ok\n", warnings: [{ code: "x", message: "warn" }] };
    },
    get stdoutBuf() {
      return stdoutBuf;
    },
    get stderrBuf() {
      return stderrBuf;
    },
    written,
    ...overrides,
  };
  return base;
}

test("CLI reads a path and prints markdown", async () => {
  const fake = io();
  const code = await runCli(["scan.jpg"], fake);
  assert.equal(code, 0);
  assert.equal(fake.stdoutBuf, "# ok\n");
  assert.match(fake.stderrBuf, /x: warn/);
});

test("CLI reads stdin from -", async () => {
  let seenFilename: string | undefined;
  const fake = io({
    stdin: Readable.from([Buffer.from(jpegBytes)]),
    stdinIsTTY: false,
    async convert(_bytes, options) {
      seenFilename = options?.filename;
      return { markdown: "from-stdin\n", warnings: [] };
    },
  });
  const code = await runCli(["-", "--filename", "scan.jpg"], fake);
  assert.equal(code, 0);
  assert.equal(fake.stdoutBuf, "from-stdin\n");
  assert.equal(seenFilename, "scan.jpg");
});

test("CLI reads a pipe when no path is given", async () => {
  const fake = io({
    stdin: Readable.from([Buffer.from("hello")]),
    stdinIsTTY: false,
    async convert() {
      return { markdown: "piped\n", warnings: [] };
    },
  });
  const code = await runCli([], fake);
  assert.equal(code, 0);
  assert.equal(fake.stdoutBuf, "piped\n");
});

test("CLI --json prints the convert result", async () => {
  const fake = io();
  const code = await runCli(["file.docx", "--json"], fake);
  assert.equal(code, 0);
  assert.match(fake.stdoutBuf, /"markdown": "# ok\\n"/);
  assert.equal(fake.stderrBuf, "");
});

test("CLI exits 1 for a missing path", async () => {
  const fake = io({
    async readFile() {
      throw new Error("ENOENT");
    },
  });
  const code = await runCli(["missing.pdf"], fake);
  assert.equal(code, 1);
  assert.match(fake.stderrBuf, /ENOENT/);
});

test("CLI exits 1 for empty stdin", async () => {
  const fake = io({
    stdin: Readable.from([]),
    stdinIsTTY: false,
  });
  const code = await runCli(["-"], fake);
  assert.equal(code, 1);
  assert.match(fake.stderrBuf, /empty/);
});

test("CLI exits 1 when no path is given on a TTY", async () => {
  const fake = io({ stdinIsTTY: true });
  const code = await runCli([], fake);
  assert.equal(code, 1);
  assert.match(fake.stderrBuf, /Usage:/);
});
