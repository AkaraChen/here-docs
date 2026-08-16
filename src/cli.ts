#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { convert } from "./convert.js";
import { IllegalConvertInputError } from "./errors.js";
import type { ConvertOptions, ConvertResult } from "./types.js";

export interface CliIo {
  stdin: NodeJS.ReadableStream;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  stdinIsTTY: boolean;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string): Promise<void>;
  convert?(input: Uint8Array, options?: ConvertOptions): Promise<ConvertResult>;
}

export async function runCli(
  argv: string[],
  io: CliIo = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readFile: (path) => readFile(path),
    writeFile: (path, data) => writeFile(path, data, "utf8"),
  },
): Promise<number> {
  let values: {
    output?: string;
    json?: boolean;
    filename?: string;
    format?: string;
    help?: boolean;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        json: { type: "boolean" },
        filename: { type: "string" },
        format: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : "invalid arguments"}\n`);
    return 1;
  }

  if (values.help) {
    io.stdout.write(usage());
    return 0;
  }

  if (positionals.length > 1) {
    io.stderr.write("pass exactly one path, or read stdin\n");
    return 1;
  }

  const positional = positionals[0];
  const readStdin = positional === "-" || positional === undefined;
  if (readStdin && positional === undefined && io.stdinIsTTY) {
    io.stderr.write(usage());
    return 1;
  }

  let bytes: Uint8Array;
  let filename = values.filename ?? (values.format ? `input.${values.format}` : undefined);

  if (!readStdin && positional) {
    try {
      bytes = await io.readFile(positional);
    } catch (error) {
      io.stderr.write(
        `${error instanceof Error ? error.message : `cannot read ${positional}`}\n`,
      );
      return 1;
    }
    filename ??= basename(positional);
  } else {
    bytes = await readStream(io.stdin);
    if (bytes.byteLength === 0) {
      io.stderr.write("stdin is empty\n");
      return 1;
    }
  }

  try {
    const convertFn = io.convert ?? convert;
    const result = await convertFn(bytes, { filename });
    const output = values.json ? `${JSON.stringify(result, null, 2)}\n` : result.markdown;
    if (values.output) {
      await io.writeFile(values.output, output);
    } else {
      io.stdout.write(output);
    }
    if (!values.json) {
      for (const warning of result.warnings) {
        io.stderr.write(`${warning.code}: ${warning.message}\n`);
      }
    }
    return 0;
  } catch (error) {
    if (error instanceof IllegalConvertInputError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    io.stderr.write(`${error instanceof Error ? error.message : "conversion failed"}\n`);
    return 1;
  }
}

function usage(): string {
  return `Usage: here-docs <file> | here-docs -

Options:
  -o, --output <file>  write manuscript to a file
  --json               print { markdown, warnings }
  --filename <name>    format hint (also used for stdin)
  --format <ext>       format hint extension
`;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "cli failed"}\n`);
      process.exitCode = 1;
    },
  );
}
