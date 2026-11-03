import { recognizeAssets } from "../assets.js";
import { WarningCode } from "../errors.js";
import { renderHtml } from "../html/render.js";
import { fence } from "../markdown/fence.js";
import { decodeText } from "../text/decode.js";
import type { ConvertDeps, ConvertPart, Warning } from "../types.js";
import { wholePart } from "./part.js";

type Source = string | string[] | undefined;

interface NotebookOutput {
  output_type?: string;
  name?: string;
  text?: Source;
  data?: Record<string, Source>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  // nbformat 3 keeps representations at the top level.
  html?: Source;
  png?: string;
  jpeg?: string;
  markdown?: Source;
}

interface NotebookCell {
  cell_type?: string;
  source?: Source;
  input?: Source;
  level?: number;
  outputs?: NotebookOutput[];
}

interface Notebook {
  cells?: NotebookCell[];
  worksheets?: Array<{ cells?: NotebookCell[] }>;
  metadata?: {
    kernelspec?: { language?: string };
    language_info?: { name?: string };
    language?: string;
  };
}

/** Markdown cells as written, code cells fenced in the kernel language, outputs as text, tables, or OCR text. */
export async function* notebookParts(bytes: Uint8Array, deps: ConvertDeps, signal?: AbortSignal): AsyncGenerator<ConvertPart> {
  signal?.throwIfAborted();
  let notebook: Notebook;
  try {
    notebook = JSON.parse(decodeText(bytes)?.text ?? "") as Notebook;
  } catch (error) {
    yield wholePart("", [{ code: WarningCode.malformed, message: error instanceof Error ? error.message : "notebook is not JSON" }]);
    return;
  }
  const cells = notebook.cells ?? notebook.worksheets?.flatMap((sheet) => sheet.cells ?? []) ?? [];
  const lang = notebook.metadata?.kernelspec?.language ?? notebook.metadata?.language_info?.name ?? notebook.metadata?.language ?? "";
  const sections: string[] = [];
  const warnings: Warning[] = [];
  for (const cell of cells) {
    signal?.throwIfAborted();
    const source = joinSource(cell.source ?? cell.input).replace(/\s+$/, "");
    switch (cell.cell_type) {
      case "markdown":
        push(sections, source);
        break;
      case "heading":
        push(sections, source ? `${"#".repeat(Math.min(Math.max(cell.level ?? 1, 1), 6))} ${source}` : "");
        break;
      case "code":
        push(sections, source ? fence(source, lang) : "");
        for (const output of cell.outputs ?? []) {
          push(sections, await renderOutput(output, deps, signal, warnings));
        }
        break;
      case "raw":
        push(sections, source ? fence(source) : "");
        break;
    }
  }
  yield wholePart(sections.join("\n\n"), warnings);
}

async function renderOutput(
  output: NotebookOutput,
  deps: ConvertDeps,
  signal: AbortSignal | undefined,
  warnings: Warning[],
): Promise<string> {
  if (output.output_type === "stream") {
    const text = stripAnsi(joinSource(output.text));
    return text.trim() ? fence(text) : "";
  }
  if (output.output_type === "error" || output.output_type === "pyerr") {
    const traceback = (output.traceback ?? []).map(stripAnsi).join("\n");
    return fence(traceback || `${output.ename ?? "Error"}: ${output.evalue ?? ""}`);
  }
  const data: Record<string, Source> = output.data ?? {
    "text/markdown": output.markdown,
    "text/html": output.html,
    "image/png": output.png,
    "image/jpeg": output.jpeg,
    "text/plain": output.text,
  };
  const markdown = joinSource(data["text/markdown"]);
  if (markdown.trim()) {
    return markdown.trim();
  }
  const html = joinSource(data["text/html"]);
  if (html.trim()) {
    const rendered = await renderHtml(html, deps, signal);
    warnings.push(...rendered.warnings);
    return rendered.markdown.trim();
  }
  for (const type of ["image/png", "image/jpeg"]) {
    const base64 = joinSource(data[type]);
    if (!base64) {
      continue;
    }
    const asset = { id: 0, mediaType: type, originPart: "output", data: new Uint8Array(Buffer.from(base64, "base64")) };
    const ocr = await recognizeAssets([asset], deps, signal);
    warnings.push(...ocr.warnings);
    return ocr.ocrByAssetId.get(0) ?? "";
  }
  const plain = stripAnsi(joinSource(data["text/plain"]));
  return plain.trim() ? fence(plain) : "";
}

/** Lines are stored with their newlines (nbformat 4) or without them (early nbformat 2/3 writers), as nbformat reads them. */
function joinSource(source: Source): string {
  if (!Array.isArray(source)) {
    return source ?? "";
  }
  return /[\r\n]$/.test(source[0] ?? "") ? source.join("") : source.join("\n");
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

function push(sections: string[], text: string): void {
  if (text.trim()) {
    sections.push(text);
  }
}
