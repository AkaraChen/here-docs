import type { AnyNode, Element } from "domhandler";
import { isTag, isText } from "domhandler";
import { unzipSync } from "fflate";
import { parseDocument } from "htmlparser2";
import { zipEntryNames } from "../detect.js";
import { zipPayload } from "../zip.js";
import type { TextRun } from "./layout.js";

/** Anything with child nodes: a parsed XML document or an element. */
type Container = { children: AnyNode[] };

/** An image placed on a page: its resource bytes and its box, for reading order. */
export interface PlacedImage {
  path: string;
  x: number;
  y: number;
}

export interface OfdPageContent {
  texts: TextRun[];
  images: PlacedImage[];
}

export interface OfdDocument {
  pageCount: number;
  /** Parses one page (and the template pages it uses). */
  page(index: number): OfdPageContent;
  /** Reads a media file of the package; null when it is missing. */
  media(path: string): Uint8Array | null;
}

/** Opens an OFD package: only its XML parts are decompressed up front. */
export function openOfd(input: Uint8Array): OfdDocument {
  const bytes = zipPayload(input);
  const xml = unzipSync(bytes, { filter: (file) => file.name.toLowerCase().endsWith(".xml") });
  const files = new PackageFiles(zipEntryNames(bytes), xml);
  const root = files.xml("OFD.xml");
  if (!root) {
    throw new Error("OFD.xml is missing");
  }
  const docRootPath = textOf(first(root, "DocRoot"));
  const docPath = docRootPath ? files.resolve("", docRootPath) : null;
  const doc = docPath ? files.xml(docPath) : null;
  if (!doc || !docPath) {
    throw new Error("the OFD document root is missing");
  }
  const docDir = dirname(docPath);

  const resources: Resources = { media: new Map(), units: new Map() };
  const commonData = first(doc, "CommonData");
  for (const tag of ["PublicRes", "DocumentRes"]) {
    for (const res of children(commonData, tag)) {
      readResources(files, files.resolve(docDir, textOf(res)), resources);
    }
  }
  const templates = new Map<string, string>();
  for (const template of children(commonData, "TemplatePage")) {
    const id = template.attribs.ID;
    const loc = template.attribs.BaseLoc;
    if (id && loc) {
      templates.set(id, files.resolve(docDir, loc));
    }
  }
  const pagePaths = children(first(doc, "Pages"), "Page")
    .map((page) => page.attribs.BaseLoc)
    .filter((loc): loc is string => Boolean(loc))
    .map((loc) => files.resolve(docDir, loc));

  return {
    pageCount: pagePaths.length,
    page(index) {
      const content: OfdPageContent = { texts: [], images: [] };
      const pagePath = pagePaths[index];
      const page = pagePath ? files.xml(pagePath) : null;
      if (!page || !pagePath) {
        throw new Error(`page ${index + 1} content is missing`);
      }
      const pageResources: Resources = { media: new Map(resources.media), units: new Map(resources.units) };
      const pageRoot = first(page, "Page");
      for (const res of children(pageRoot, "PageRes")) {
        readResources(files, files.resolve(dirname(pagePath), textOf(res)), pageResources);
      }
      for (const ref of children(pageRoot, "Template")) {
        const templatePath = templates.get(ref.attribs.TemplateID ?? "");
        const template = templatePath ? files.xml(templatePath) : null;
        if (template) {
          collectObjects(first(template, "Content"), IDENTITY, pageResources, content, 0);
        }
      }
      collectObjects(first(page, "Content"), IDENTITY, pageResources, content, 0);
      return content;
    },
    media(path) {
      const target = files.find(path);
      if (!target) {
        return null;
      }
      const entry = unzipSync(bytes, { filter: (file) => normalizePath(file.name) === target });
      return Object.values(entry)[0] ?? null;
    },
  };
}

/** Package paths: producers disagree on relative bases, leading slashes, and letter case. */
class PackageFiles {
  private readonly paths = new Set<string>();
  private readonly byLowerPath = new Map<string, string>();
  private readonly xmlData = new Map<string, Uint8Array>();
  private readonly parsed = new Map<string, Container>();

  constructor(names: readonly string[], xml: Record<string, Uint8Array>) {
    for (const name of names) {
      const path = normalizePath(name);
      this.paths.add(path);
      this.byLowerPath.set(path.toLowerCase(), path);
    }
    for (const [name, data] of Object.entries(xml)) {
      this.xmlData.set(normalizePath(name), data);
    }
  }

  /** `loc` relative to `baseDir`, else relative to the package root, else matched case-insensitively. */
  resolve(baseDir: string, loc: string): string {
    const relative = normalizePath(loc.startsWith("/") ? loc : `${baseDir}/${loc}`);
    return this.find(relative) ?? this.find(loc) ?? relative;
  }

  find(path: string): string | null {
    const normalized = normalizePath(path);
    if (this.paths.has(normalized)) {
      return normalized;
    }
    return this.byLowerPath.get(normalized.toLowerCase()) ?? null;
  }

  xml(path: string): Container | null {
    const found = this.find(path);
    const data = found ? this.xmlData.get(found) : undefined;
    if (!found || !data) {
      return null;
    }
    let document = this.parsed.get(found);
    if (!document) {
      document = parseDocument(new TextDecoder().decode(data), { xmlMode: true });
      this.parsed.set(found, document);
    }
    return document;
  }
}

/** Media file paths and composite graphic units, by resource ID. */
interface Resources {
  media: Map<string, string>;
  units: Map<string, Element>;
}

/** An affine transform `[a, b, c, d, e, f]`: (x, y) maps to (a·x + c·y + e, b·x + d·y + f). */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Composite units can nest; deeper references are ignored rather than followed forever. */
const MAX_COMPOSITE_DEPTH = 8;

function readResources(files: PackageFiles, resPath: string, resources: Resources): void {
  const res = files.xml(resPath);
  const resRoot = res ? first(res, "Res") : null;
  if (!resRoot) {
    return;
  }
  const baseLoc = resRoot.attribs.BaseLoc ?? "";
  const baseDir = baseLoc.startsWith("/") ? normalizePath(baseLoc) : normalizePath(`${dirname(resPath)}/${baseLoc}`);
  for (const item of descendants(resRoot, "MultiMedia")) {
    const file = textOf(first(item, "MediaFile"));
    if (item.attribs.ID && file) {
      resources.media.set(item.attribs.ID, file.startsWith("/") ? normalizePath(file) : normalizePath(`${baseDir}/${file}`));
    }
  }
  for (const unit of descendants(resRoot, "CompositeGraphicUnit")) {
    if (unit.attribs.ID) {
      resources.units.set(unit.attribs.ID, unit);
    }
  }
}

/**
 * Text and image objects in reading-relevant positions (page millimetres). Layers and page blocks are walked
 * in place; a composite object draws a shared unit through its own matrix and boundary.
 */
function collectObjects(
  container: Container | null,
  outer: Matrix,
  resources: Resources,
  out: OfdPageContent,
  depth: number,
): void {
  for (const node of container?.children ?? []) {
    if (!isTag(node)) {
      continue;
    }
    switch (localName(node.name)) {
      case "Layer":
      case "PageBlock":
        collectObjects(node, outer, resources, out, depth);
        break;
      case "TextObject":
        collectText(node, outer, out);
        break;
      case "ImageObject": {
        const path = resources.media.get(node.attribs.ResourceID ?? "");
        if (path) {
          const [x = 0, y = 0] = numbers(node.attribs.Boundary);
          const [px, py] = apply(outer, x, y);
          out.images.push({ path, x: px, y: py });
        }
        break;
      }
      case "CompositeObject": {
        const unit = resources.units.get(node.attribs.ResourceID ?? "");
        if (unit && depth < MAX_COMPOSITE_DEPTH) {
          const [bx = 0, by = 0] = numbers(node.attribs.Boundary);
          const placed = compose(outer, compose([1, 0, 0, 1, bx, by], matrixOf(node.attribs.CTM)));
          collectObjects(first(unit, "Content"), placed, resources, out, depth + 1);
        }
        break;
      }
    }
  }
}

function collectText(object: Element, outer: Matrix, out: OfdPageContent): void {
  const [bx = 0, by = 0] = numbers(object.attribs.Boundary);
  const local = compose([1, 0, 0, 1, bx, by], matrixOf(object.attribs.CTM));
  const matrix = compose(outer, local);
  const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) || 1;
  const size = (Number.parseFloat(object.attribs.Size ?? "") || 3.5) * scale;
  let x = 0;
  let y = 0;
  for (const code of children(object, "TextCode")) {
    x = numberOr(code.attribs.X, x);
    y = numberOr(code.attribs.Y, y);
    const text = textOf(code);
    if (!text.trim()) {
      continue;
    }
    const advance = deltaAdvance(code.attribs.DeltaX, [...text].length - 1);
    const [px, py] = apply(matrix, x, y);
    out.texts.push({
      text,
      x: px,
      y: py,
      size,
      width: advance === null ? estimateWidth(text, size) : advance * scale + size,
    });
  }
}

function matrixOf(value: string | undefined): Matrix {
  const parsed = numbers(value);
  return parsed.length === 6 ? (parsed as unknown as Matrix) : IDENTITY;
}

/** `outer ∘ inner`: apply `inner` first. */
function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

/**
 * The advance of the first `glyphs` gaps of a `DeltaX` list, or null without one. `g 3 1.5` repeats 1.5
 * three times; the sum is computed, not expanded, so a huge repeat count costs nothing.
 */
function deltaAdvance(value: string | undefined, glyphs: number): number | null {
  const tokens = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  let remaining = glyphs;
  let advance = 0;
  for (let i = 0; i < tokens.length && remaining > 0; i += 1) {
    if (tokens[i] === "g") {
      const count = Number.parseInt(tokens[i + 1] ?? "", 10);
      const step = Number.parseFloat(tokens[i + 2] ?? "");
      if (Number.isFinite(count) && count > 0 && Number.isFinite(step)) {
        const used = Math.min(count, remaining);
        advance += used * step;
        remaining -= used;
      }
      i += 2;
    } else {
      const step = Number.parseFloat(tokens[i]!);
      if (Number.isFinite(step)) {
        advance += step;
        remaining -= 1;
      }
    }
  }
  return advance;
}

function estimateWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(char) ? size : size * 0.5;
  }
  return width;
}

function numbers(value: string | undefined): number[] {
  return (value ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number.parseFloat)
    .filter(Number.isFinite);
}

function numberOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

function children(parent: Container | null, name: string): Element[] {
  if (!parent) {
    return [];
  }
  return parent.children.filter((node): node is Element => isTag(node) && localName(node.name) === name);
}

function first(parent: Container | null, name: string): Element | null {
  return descendants(parent, name)[0] ?? null;
}

function descendants(parent: Container | null, name: string): Element[] {
  const out: Element[] = [];
  const visit = (nodes: readonly AnyNode[]) => {
    for (const node of nodes) {
      if (isTag(node)) {
        if (localName(node.name) === name) {
          out.push(node);
        }
        visit(node.children);
      }
    }
  };
  visit(parent?.children ?? []);
  return out;
}

function textOf(node: Element | null): string {
  if (!node) {
    return "";
  }
  return node.children.map((child) => (isText(child) ? child.data : isTag(child) ? textOf(child) : "")).join("").trim();
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? "" : normalized.slice(0, slash);
}
