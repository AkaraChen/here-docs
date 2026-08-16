import type {
  AnydocBlock,
  AnydocDocument,
  AnydocInline,
  AnydocList,
  AnydocNote,
  AnydocStyle,
  AnydocTable,
} from "../types.js";

const PLAIN: AnydocStyle = { bold: false, italic: false, strike: false, code: false };

export function documentToMarkdown(
  document: AnydocDocument,
  ocrByAssetId: ReadonlyMap<number, string>,
): string {
  const noteNumbers = numberNotes(document.notes);
  const body = renderBlocks(document.blocks, ocrByAssetId, noteNumbers);
  const notes = renderNotes(document.notes, ocrByAssetId, noteNumbers);
  const parts = [body, notes].filter((part) => part.length > 0);
  if (parts.length === 0) {
    return "";
  }
  return `${parts.join("\n\n")}\n`;
}

function numberNotes(notes: AnydocNote[]): Map<string, number> {
  const map = new Map<string, number>();
  notes.forEach((note, index) => {
    map.set(note.id, index + 1);
  });
  return map;
}

function renderBlocks(
  blocks: AnydocBlock[],
  ocrByAssetId: ReadonlyMap<number, string>,
  noteNumbers: ReadonlyMap<string, number>,
): string {
  return blocks
    .map((block) => renderBlock(block, ocrByAssetId, noteNumbers))
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function renderBlock(
  block: AnydocBlock,
  ocrByAssetId: ReadonlyMap<number, string>,
  noteNumbers: ReadonlyMap<string, number>,
): string {
  switch (block.kind) {
    case "heading": {
      const level = Math.min(Math.max(block.level ?? 1, 1), 6);
      const title = renderInlines(block.content ?? [], ocrByAssetId, noteNumbers);
      return `${"#".repeat(level)} ${title}`.trimEnd();
    }
    case "paragraph":
      return renderInlines(block.content ?? [], ocrByAssetId, noteNumbers);
    case "list":
      return block.list ? renderList(block.list, ocrByAssetId, noteNumbers, 0) : "";
    case "table":
      return block.table ? renderTable(block.table, ocrByAssetId, noteNumbers) : "";
    case "blockQuote": {
      const inner = renderBlocks(block.blocks ?? [], ocrByAssetId, noteNumbers);
      return inner
        .split("\n")
        .map((line) => (line.length > 0 ? `> ${line}` : ">"))
        .join("\n");
    }
    case "codeBlock": {
      const lang = block.lang ?? "";
      return `\`\`\`${lang}\n${block.text ?? ""}\n\`\`\``;
    }
    case "rule":
      return "---";
    default:
      return "";
  }
}

function renderList(
  list: AnydocList,
  ocrByAssetId: ReadonlyMap<number, string>,
  noteNumbers: ReadonlyMap<string, number>,
  depth: number,
): string {
  const indent = "  ".repeat(depth);
  return list.items
    .map((item, index) => {
      const marker = item.markerLabel ?? listMarker(list, index);
      const checkbox =
        item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] ";
      const inner = renderBlocks(item.blocks, ocrByAssetId, noteNumbers);
      const [first, ...rest] = inner.split("\n");
      const head = `${indent}${marker} ${checkbox}${first ?? ""}`.trimEnd();
      if (rest.length === 0) {
        return head;
      }
      const nested = rest.map((line) => (line.length > 0 ? `${indent}  ${line}` : "")).join("\n");
      return `${head}\n${nested}`;
    })
    .join("\n");
}

function listMarker(list: AnydocList, index: number): string {
  const n = list.start + index;
  switch (list.marker) {
    case "decimal":
      return `${n}.`;
    case "lowerAlpha":
      return `${alpha(n, false)}.`;
    case "upperAlpha":
      return `${alpha(n, true)}.`;
    case "lowerRoman":
      return `${roman(n).toLowerCase()}.`;
    case "upperRoman":
      return `${roman(n)}.`;
    default:
      return "-";
  }
}

function alpha(n: number, upper: boolean): string {
  let value = n;
  let out = "";
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode((upper ? 65 : 97) + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out || (upper ? "A" : "a");
}

function roman(n: number): string {
  const pairs: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = n;
  let out = "";
  for (const [value, glyph] of pairs) {
    while (remaining >= value) {
      out += glyph;
      remaining -= value;
    }
  }
  return out;
}

function renderTable(
  table: AnydocTable,
  ocrByAssetId: ReadonlyMap<number, string>,
  noteNumbers: ReadonlyMap<string, number>,
): string {
  const rows = table.grid.map((row) =>
    row
      .filter((slot) => slot.kind === "origin")
      .map((slot) =>
        escapeCell(renderBlocks(slot.cell?.blocks ?? [], ocrByAssetId, noteNumbers)),
      ),
  );
  const width = Math.max(1, ...rows.map((row) => row.length));
  const padded = rows.map((row) => {
    const copy = [...row];
    while (copy.length < width) {
      copy.push("");
    }
    return copy;
  });
  if (padded.length === 0) {
    return "";
  }
  const headerIndex = table.headerRows > 0 ? 0 : -1;
  const header = headerIndex === 0 ? padded[0] : Array.from({ length: width }, () => "");
  const body = headerIndex === 0 ? padded.slice(1) : padded;
  const lines = [
    `| ${header?.join(" | ") ?? ""} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function escapeCell(text: string): string {
  return text.replace(/\n+/g, " ").replace(/\|/g, "\\|").trim();
}

function renderInlines(
  inlines: AnydocInline[],
  ocrByAssetId: ReadonlyMap<number, string>,
  noteNumbers: ReadonlyMap<string, number>,
): string {
  return inlines.map((inline) => renderInline(inline, ocrByAssetId, noteNumbers)).join("");
}

function renderInline(
  inline: AnydocInline,
  ocrByAssetId: ReadonlyMap<number, string>,
  noteNumbers: ReadonlyMap<string, number>,
): string {
  switch (inline.kind) {
    case "text":
      return styleText(inline.text ?? "", inline.style ?? PLAIN);
    case "link": {
      const label = renderInlines(inline.content ?? [], ocrByAssetId, noteNumbers);
      const href = inline.target?.value ?? "";
      if (!href) {
        return label;
      }
      const url = inline.target?.kind === "anchor" ? `#${href}` : href;
      return `[${label}](${url})`;
    }
    case "image":
      return renderImage(inline, ocrByAssetId);
    case "noteRef": {
      const num = inline.noteId ? noteNumbers.get(inline.noteId) : undefined;
      return num === undefined ? "" : `[^${num}]`;
    }
    case "lineBreak":
      return "\\\n";
    case "anchor":
      return "";
    default:
      return "";
  }
}

function renderImage(
  inline: AnydocInline,
  ocrByAssetId: ReadonlyMap<number, string>,
): string {
  if (inline.source?.kind === "external" && inline.source.url) {
    return `![${inline.alt ?? ""}](${inline.source.url})`;
  }
  if (inline.source?.kind === "asset" && inline.source.assetId !== undefined) {
    const ocr = ocrByAssetId.get(inline.source.assetId);
    if (ocr && ocr.trim().length > 0) {
      return ocr.trim();
    }
  }
  return (inline.alt ?? "").trim();
}

function styleText(text: string, style: AnydocStyle): string {
  if (style.code) {
    return `\`${text.replace(/`/g, "\\`")}\``;
  }
  let out = escapeMarkdown(text);
  if (style.italic) {
    out = `*${out}*`;
  }
  if (style.bold) {
    out = `**${out}**`;
  }
  if (style.strike) {
    out = `~~${out}~~`;
  }
  return out;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]#])/g, "\\$1");
}

function renderNotes(
  notes: AnydocNote[],
  ocrByAssetId: ReadonlyMap<number, string>,
  noteNumbers: ReadonlyMap<string, number>,
): string {
  return notes
    .map((note) => {
      const num = noteNumbers.get(note.id);
      if (num === undefined) {
        return "";
      }
      const body = renderBlocks(note.blocks, ocrByAssetId, noteNumbers).replace(/\n/g, " ");
      return `[^${num}]: ${body}`.trimEnd();
    })
    .filter((line) => line.length > 0)
    .join("\n");
}
