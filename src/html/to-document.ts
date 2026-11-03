import type { AnyNode, Element } from "domhandler";
import { isTag, isText } from "domhandler";
import { parseDocument } from "htmlparser2";
import type {
  AnydocAsset,
  AnydocBlock,
  AnydocCellSlot,
  AnydocDocument,
  AnydocInline,
  AnydocList,
  AnydocListItem,
  AnydocStyle,
} from "../types.js";

export interface ResolvedImage {
  data: Uint8Array;
  mediaType: string;
}

/** Maps an `<img src>` to stored bytes (a `cid:` part, an archived resource). `data:` URIs are decoded without it. */
export type ImageResolver = (src: string) => ResolvedImage | null;

export interface HtmlToDocumentOptions {
  resolveImage?: ImageResolver;
}

const PLAIN: AnydocStyle = { bold: false, italic: false, strike: false, code: false };

// `head` itself is walked: its metadata elements are skipped here, and stray content that malformed pages
// put there (browsers move it to the body) still renders.
const SKIPPED = new Set([
  "title",
  "meta",
  "link",
  "base",
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "svg",
  "math",
  "canvas",
  "video",
  "audio",
  "source",
  "track",
  "map",
  "area",
  "select",
  "option",
  "textarea",
  "button",
  "input",
  "xml",
]);

const BLOCK_CONTAINERS = new Set([
  "html",
  "head",
  "body",
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "nav",
  "figure",
  "figcaption",
  "address",
  "center",
  "details",
  "summary",
  "form",
  "fieldset",
  "legend",
  "hgroup",
  "search",
  "dialog",
  "li",
  "dd",
  "dt",
  "tr",
  "td",
  "th",
  "tbody",
  "thead",
  "tfoot",
  "caption",
]);

const BLOCK_TAGS = new Set([
  ...BLOCK_CONTAINERS,
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "menu",
  "dir",
  "dl",
  "blockquote",
  "pre",
  "table",
  "hr",
]);

const BOLD = new Set(["b", "strong"]);
const ITALIC = new Set(["i", "em", "cite", "dfn", "var"]);
const STRIKE = new Set(["s", "strike", "del"]);
const CODE = new Set(["code", "kbd", "samp", "tt"]);

/** Parses HTML into the document model shared with Office documents. Embedded images become assets. */
export function htmlToDocument(html: string, options: HtmlToDocumentOptions = {}): AnydocDocument {
  const dom = parseDocument(html, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  const converter = new Converter(options.resolveImage);
  // A page that marks its main content gets only that converted: menus, sidebars, and footers stay out.
  const main = findFirst(dom.children, "main") ?? findFirst(dom.children, "div", (element) => element.attribs.role === "main");
  return {
    blocks: converter.blocks(main ? [main] : dom.children, PLAIN),
    notes: [],
    assets: converter.assets,
  };
}

/** A run of blocks under construction: inline content accumulates into the current paragraph. */
class Flow {
  readonly blocks: AnydocBlock[] = [];
  private inlines: AnydocInline[] = [];

  addInline(inline: AnydocInline): void {
    this.inlines.push(inline);
  }

  addBlock(block: AnydocBlock): void {
    this.flush();
    this.blocks.push(block);
  }

  flush(): void {
    const content = normalizeInlines(this.inlines);
    this.inlines = [];
    if (content.length > 0) {
      this.blocks.push({ kind: "paragraph", content });
    }
  }
}

class Converter {
  readonly assets: AnydocAsset[] = [];

  constructor(private readonly resolveImage: ImageResolver | undefined) {}

  blocks(nodes: readonly AnyNode[], style: AnydocStyle): AnydocBlock[] {
    const flow = new Flow();
    for (const node of nodes) {
      this.walk(node, flow, style);
    }
    flow.flush();
    return flow.blocks;
  }

  /** Inline content of `nodes`; block structure inside (a heading with paragraphs) becomes line breaks. */
  inlines(nodes: readonly AnyNode[], style: AnydocStyle): AnydocInline[] {
    const out: AnydocInline[] = [];
    for (const block of this.blocks(nodes, style)) {
      const content = blockInlines(block);
      if (content.length === 0) {
        continue;
      }
      if (out.length > 0) {
        out.push({ kind: "lineBreak" });
      }
      out.push(...content);
    }
    return normalizeInlines(out);
  }

  private walk(node: AnyNode, flow: Flow, style: AnydocStyle): void {
    if (isText(node)) {
      flow.addInline({ kind: "text", text: collapseWhitespace(node.data), style });
      return;
    }
    if (!isTag(node)) {
      return;
    }
    const name = node.name;
    if (SKIPPED.has(name) || isHidden(node) || isNavigation(node)) {
      return;
    }
    if (name === "br") {
      flow.addInline({ kind: "lineBreak" });
      return;
    }
    if (name === "img") {
      const image = this.image(node);
      if (image) {
        flow.addInline(image);
      }
      return;
    }
    if (name === "hr") {
      flow.addBlock({ kind: "rule" });
      return;
    }
    const heading = /^h([1-6])$/.exec(name);
    if (heading) {
      // A Markdown heading is one line: breaks inside it become spaces.
      const content = normalizeInlines(
        this.inlines(node.children, style).map((inline) =>
          inline.kind === "lineBreak" ? { kind: "text", text: " ", style: PLAIN } : inline,
        ),
      );
      if (content.length > 0) {
        flow.addBlock({ kind: "heading", level: Number(heading[1]), content });
      }
      return;
    }
    switch (name) {
      case "a":
        this.link(node, flow, style);
        return;
      case "ul":
      case "ol":
      case "menu":
      case "dir": {
        const list = this.list(node, style);
        if (list) {
          flow.addBlock({ kind: "list", list });
        } else {
          flow.flush();
        }
        return;
      }
      case "dl":
        this.definitionList(node, flow, style);
        return;
      case "blockquote": {
        const blocks = this.blocks(node.children, style);
        if (blocks.length > 0) {
          flow.addBlock({ kind: "blockQuote", blocks });
        }
        return;
      }
      case "pre": {
        const text = preText(node).replace(/^\n/, "").replace(/\s+$/, "");
        if (text.length > 0) {
          flow.addBlock({ kind: "codeBlock", text, lang: codeLanguage(node) });
        }
        return;
      }
      case "table":
        this.table(node, flow, style);
        return;
    }
    if (BLOCK_CONTAINERS.has(name)) {
      flow.flush();
      for (const child of node.children) {
        this.walk(child, flow, style);
      }
      flow.flush();
      return;
    }
    const inner = styleFor(name, style);
    for (const child of node.children) {
      this.walk(child, flow, inner);
    }
  }

  private link(node: Element, flow: Flow, style: AnydocStyle): void {
    const href = (node.attribs.href ?? "").trim();
    if (!href || /^javascript:/i.test(href) || hasBlockDescendant(node)) {
      for (const child of node.children) {
        this.walk(child, flow, style);
      }
      return;
    }
    const content = this.inlines(node.children, style);
    if (content.length === 0) {
      return;
    }
    if (href.startsWith("#")) {
      flow.addInline({ kind: "link", content, target: { kind: "anchor", value: href.slice(1) } });
      return;
    }
    const kind = /^[a-z][a-z0-9+.-]*:/i.test(href) ? "external" : "relative";
    flow.addInline({ kind: "link", content, target: { kind, value: href.replace(/[ ()<>]/g, encodeURIComponent) } });
  }

  private image(node: Element): AnydocInline | null {
    const src = (node.attribs.src ?? "").trim();
    const alt = (node.attribs.alt ?? node.attribs.title ?? "").replace(/\s+/g, " ").trim();
    const width = Number.parseInt(node.attribs.width ?? "", 10);
    const height = Number.parseInt(node.attribs.height ?? "", 10);
    if (width > 0 && height > 0 && width <= 2 && height <= 2) {
      // Spacers and tracking pixels carry no content.
      return null;
    }
    const resolved = src.startsWith("data:") ? decodeDataUri(src) : src ? (this.resolveImage?.(src) ?? null) : null;
    if (resolved) {
      const id = this.assets.length;
      this.assets.push({ id, mediaType: resolved.mediaType, originPart: src.slice(0, 200), data: resolved.data });
      return { kind: "image", alt, source: { kind: "asset", assetId: id } };
    }
    if (!alt) {
      return null;
    }
    if (/^https?:/i.test(src)) {
      return { kind: "image", alt, source: { kind: "external", url: src.replace(/[ ()<>]/g, encodeURIComponent) } };
    }
    return { kind: "image", alt, source: { kind: "unavailable" } };
  }

  private list(node: Element, style: AnydocStyle): AnydocList | null {
    const ordered = node.name === "ol";
    const items: AnydocListItem[] = [];
    for (const child of node.children) {
      if (isTag(child) && child.name === "li") {
        const checkbox = findFirst(child.children, "input", (input) => (input.attribs.type ?? "").toLowerCase() === "checkbox");
        const blocks = this.blocks(child.children, style);
        if (blocks.length > 0 || checkbox) {
          items.push(checkbox ? { blocks, checked: checkbox.attribs.checked !== undefined } : { blocks });
        }
      } else if (isTag(child) && (child.name === "ul" || child.name === "ol")) {
        // A list nested directly in a list belongs to the previous item.
        const nested = this.list(child, style);
        const previous = items[items.length - 1];
        if (nested && previous) {
          previous.blocks.push({ kind: "list", list: nested });
        } else if (nested) {
          items.push({ blocks: [{ kind: "list", list: nested }] });
        }
      } else if (!isText(child) || child.data.trim()) {
        const blocks = this.blocks([child], style);
        if (blocks.length > 0) {
          items.push({ blocks });
        }
      }
    }
    if (items.length === 0) {
      return null;
    }
    const start = Number.parseInt(node.attribs.start ?? "", 10);
    return { marker: ordered ? orderedMarker(node.attribs.type) : "bullet", start: Number.isFinite(start) ? start : 1, items };
  }

  private definitionList(node: Element, flow: Flow, style: AnydocStyle): void {
    flow.flush();
    for (const child of node.children) {
      if (!isTag(child)) {
        continue;
      }
      if (child.name === "dt") {
        const content = this.inlines(child.children, { ...style, bold: true });
        if (content.length > 0) {
          flow.addBlock({ kind: "paragraph", content });
        }
      } else {
        for (const block of this.blocks(child.children, style)) {
          flow.addBlock(block);
        }
      }
    }
  }

  private table(node: Element, flow: Flow, style: AnydocStyle): void {
    const rows = tableRows(node);
    const width = Math.max(0, ...rows.map((row) => cellsOf(row).reduce((sum, cell) => sum + span(cell.attribs.colspan, 1000), 0)));
    const role = (node.attribs.role ?? "").toLowerCase();
    const caption = findFirst(node.children, "caption", undefined, false);
    const layout = role === "presentation" || role === "none" || rows.length < 2 || width < 2 || hasNestedTable(node);
    flow.flush();
    if (caption) {
      for (const block of this.blocks(caption.children, style)) {
        flow.addBlock(block);
      }
    }
    if (layout) {
      // Layout tables (common in e-mail) carry content, not data: emit their cells in reading order.
      for (const row of rows) {
        for (const cell of cellsOf(row)) {
          for (const block of this.blocks(cell.children, style)) {
            flow.addBlock(block);
          }
        }
      }
      return;
    }
    const grid: AnydocCellSlot[][] = rows.map(() => []);
    rows.forEach((row, r) => {
      const slots = grid[r]!;
      let c = 0;
      for (const cell of cellsOf(row)) {
        while (slots[c]) {
          c += 1;
        }
        const colSpan = span(cell.attribs.colspan, 1000);
        const rowSpan = Math.min(span(cell.attribs.rowspan, rows.length), rows.length - r);
        slots[c] = { kind: "origin", cell: { blocks: this.blocks(cell.children, style), colSpan, rowSpan } };
        for (let dr = 0; dr < rowSpan; dr += 1) {
          for (let dc = 0; dc < colSpan; dc += 1) {
            if (dr > 0 || dc > 0) {
              grid[r + dr]![c + dc] = { kind: "covered" };
            }
          }
        }
        c += colSpan;
      }
    });
    for (const slots of grid) {
      for (let c = 0; c < slots.length; c += 1) {
        slots[c] ??= { kind: "origin", cell: { blocks: [], colSpan: 1, rowSpan: 1 } };
      }
    }
    flow.addBlock({ kind: "table", table: { grid, headerRows: headerRows(rows), kind: "data" } });
  }
}

function isHidden(node: Element): boolean {
  return node.attribs.hidden !== undefined || node.attribs["aria-hidden"] === "true" || /display\s*:\s*none/i.test(node.attribs.style ?? "");
}

/** Site navigation (menus, breadcrumbs, tables of contents) is chrome, not content. */
function isNavigation(node: Element): boolean {
  return node.name === "nav" || node.attribs.role === "navigation";
}

function styleFor(name: string, style: AnydocStyle): AnydocStyle {
  if (BOLD.has(name)) return { ...style, bold: true };
  if (ITALIC.has(name)) return { ...style, italic: true };
  if (STRIKE.has(name)) return { ...style, strike: true };
  if (CODE.has(name)) return { ...style, code: true };
  return style;
}

function orderedMarker(type: string | undefined): AnydocList["marker"] {
  switch (type) {
    case "a":
      return "lowerAlpha";
    case "A":
      return "upperAlpha";
    case "i":
      return "lowerRoman";
    case "I":
      return "upperRoman";
    default:
      return "decimal";
  }
}

function blockInlines(block: AnydocBlock): AnydocInline[] {
  if (block.kind === "paragraph" || block.kind === "heading") {
    return block.content ?? [];
  }
  if (block.kind === "codeBlock") {
    return [{ kind: "text", text: block.text ?? "", style: { ...PLAIN, code: true } }];
  }
  const nested = block.blocks ?? block.list?.items.flatMap((item) => item.blocks) ?? [];
  const out: AnydocInline[] = [];
  for (const child of nested) {
    const content = blockInlines(child);
    if (content.length > 0) {
      if (out.length > 0) {
        out.push({ kind: "lineBreak" });
      }
      out.push(...content);
    }
  }
  return out;
}

/** Merges equal-style text, collapses whitespace across boundaries, and trims the run. */
function normalizeInlines(inlines: readonly AnydocInline[]): AnydocInline[] {
  const merged: AnydocInline[] = [];
  for (const inline of inlines) {
    const previous = merged[merged.length - 1];
    if (inline.kind === "text") {
      let text = inline.text ?? "";
      const afterSpace =
        !previous ||
        previous.kind === "lineBreak" ||
        (previous.kind === "text" && (previous.text ?? "").endsWith(" "));
      if (afterSpace && !inline.style?.code) {
        text = text.replace(/^ +/, "");
      }
      if (!text) {
        continue;
      }
      if (previous?.kind === "text" && sameStyle(previous.style, inline.style)) {
        previous.text = `${previous.text ?? ""}${text}`;
        continue;
      }
      merged.push({ ...inline, text });
      continue;
    }
    if (inline.kind === "lineBreak") {
      if (!previous || previous.kind === "lineBreak") {
        continue;
      }
      if (previous.kind === "text") {
        previous.text = (previous.text ?? "").replace(/ +$/, "");
      }
    }
    merged.push(inline);
  }
  while (merged.length > 0) {
    const last = merged[merged.length - 1]!;
    if (last.kind === "lineBreak") {
      merged.pop();
      continue;
    }
    if (last.kind === "text") {
      last.text = (last.text ?? "").replace(/ +$/, "");
      if (!last.text) {
        merged.pop();
        continue;
      }
    }
    break;
  }
  return merged.flatMap(splitStyledSpaces).filter((inline) => inline.kind !== "text" || (inline.text ?? "").length > 0);
}

/** `** bold**` is not emphasis in Markdown: edge spaces of a styled run move outside it. */
function splitStyledSpaces(inline: AnydocInline): AnydocInline[] {
  if (inline.kind !== "text" || !inline.style || sameStyle(inline.style, PLAIN)) {
    return [inline];
  }
  const text = inline.text ?? "";
  const match = /^( *)(.*?)( *)$/s.exec(text);
  if (!match || (!match[1] && !match[3])) {
    return [inline];
  }
  return [
    { kind: "text", text: match[1], style: PLAIN },
    { ...inline, text: match[2] },
    { kind: "text", text: match[3], style: PLAIN },
  ];
}

function sameStyle(a: AnydocStyle | undefined, b: AnydocStyle | undefined): boolean {
  const left = a ?? PLAIN;
  const right = b ?? PLAIN;
  return left.bold === right.bold && left.italic === right.italic && left.strike === right.strike && left.code === right.code;
}

function collapseWhitespace(text: string): string {
  // Zero-width spaces and BOMs are invisible on the page; kept, they leave empty emphasis markers behind.
  return text.replace(/[\u200b\u2060\ufeff]/g, "").replace(/[ \t\n\r\f\u00a0]+/g, " ");
}

function preText(node: AnyNode): string {
  if (isText(node)) {
    return node.data;
  }
  if (!isTag(node)) {
    return "";
  }
  if (node.name === "br") {
    return "\n";
  }
  return node.children.map(preText).join("");
}

/** `language-x` / `lang-x` (highlight.js, Prism), `brush: x` (SyntaxHighlighter, MDN), `highlight-source-x` (GitHub). */
function codeLanguage(pre: Element): string | undefined {
  const code = findFirst(pre.children, "code");
  const parent = pre.parent !== null && isTag(pre.parent) ? pre.parent : undefined;
  for (const element of [pre, code, parent]) {
    const dataLang = element?.attribs["data-lang"] ?? element?.attribs["data-language"];
    if (dataLang) {
      return dataLang;
    }
    const match = /(?:^|\s)(?:(?:language|lang|highlight-source)-|brush:\s*)([\w+#.-]+)/.exec(element?.attribs.class ?? "");
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of table.children) {
    if (!isTag(child)) {
      continue;
    }
    if (child.name === "tr") {
      rows.push(child);
    } else if (child.name === "thead" || child.name === "tbody" || child.name === "tfoot") {
      rows.push(...child.children.filter((row): row is Element => isTag(row) && row.name === "tr"));
    }
  }
  return rows;
}

function cellsOf(row: Element): Element[] {
  return row.children.filter((cell): cell is Element => isTag(cell) && (cell.name === "td" || cell.name === "th"));
}

function headerRows(rows: readonly Element[]): number {
  const inHead = rows.filter((row) => row.parent !== null && isTag(row.parent) && row.parent.name === "thead").length;
  // A Markdown table always has a header row; without a marked one, the first row serves, as for CSV.
  return Math.max(1, inHead);
}

function span(value: string | undefined, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : 1;
}

function hasNestedTable(table: Element): boolean {
  return tableRows(table).some((row) => cellsOf(row).some((cell) => findFirst(cell.children, "table") !== undefined));
}

function hasBlockDescendant(node: Element): boolean {
  return node.children.some((child) => isTag(child) && (BLOCK_TAGS.has(child.name) || hasBlockDescendant(child)));
}

function findFirst(
  nodes: readonly AnyNode[],
  name: string,
  predicate?: (element: Element) => boolean,
  deep = true,
): Element | undefined {
  for (const node of nodes) {
    if (!isTag(node)) {
      continue;
    }
    if (node.name === name && (!predicate || predicate(node))) {
      return node;
    }
    if (deep) {
      const found = findFirst(node.children, name, predicate, deep);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function decodeDataUri(uri: string): ResolvedImage | null {
  const comma = uri.indexOf(",");
  if (comma < 0) {
    return null;
  }
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const base64 = /;base64$/i.test(meta);
  const mediaType = (meta.replace(/;base64$/i, "").split(";")[0] ?? "").trim().toLowerCase();
  try {
    const data = base64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    return data.length > 0 ? { data: new Uint8Array(data), mediaType } : null;
  } catch {
    return null;
  }
}
