import { gunzipSync } from "node:zlib";
import type { AnyNode, Element } from "domhandler";
import { isTag, isText } from "domhandler";
import { parseDocument } from "htmlparser2";
import { decodeTextLoose } from "./text/decode.js";

/** What an SVG shows, in document order: lines of text, and embedded raster images to OCR. */
export type SvgItem = { kind: "text"; text: string } | { kind: "image"; data: Uint8Array; mediaType: string };

/** Not rendered, or not content: accessibility text and tooltips are skipped like hidden HTML. */
const SKIPPED = new Set(["style", "script", "title", "desc", "metadata", "defs", "symbol", "clipPath", "mask", "pattern", "marker"]);

/** Unpacked SVGZ can be large but not unbounded. */
const MAX_SVG_BYTES = 64 * 1024 * 1024;

/**
 * Reads the text an SVG draws (`<text>`, and HTML labels in `<foreignObject>` as Mermaid and draw.io write
 * them) instead of rasterizing it: exact characters, and no dependence on installed fonts. Returns an empty
 * list when the drawing has neither text nor embedded images, for example when its text is outlined as paths.
 */
export function svgItems(bytes: Uint8Array): SvgItem[] {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: MAX_SVG_BYTES }) : bytes;
  const dom = parseDocument(decodeTextLoose(raw), { xmlMode: true, decodeEntities: true });
  const items: SvgItem[] = [];
  walk(dom.children, items);
  return items;
}

function walk(nodes: readonly AnyNode[], items: SvgItem[]): void {
  for (const node of nodes) {
    if (!isTag(node)) {
      continue;
    }
    const name = localName(node.name);
    if (SKIPPED.has(name) || node.attribs.display === "none" || node.attribs.visibility === "hidden" || !languageMatches(node)) {
      continue;
    }
    if (name === "switch") {
      // A switch renders its first child whose conditions hold (feature tests pass: foreignObject is supported).
      const chosen = node.children.find((child): child is Element => isTag(child) && languageMatches(child));
      if (chosen) {
        walk([chosen], items);
      }
      continue;
    }
    if (name === "text") {
      for (const line of textLines(node)) {
        items.push({ kind: "text", text: line });
      }
      continue;
    }
    if (name === "foreignObject") {
      for (const line of htmlLines(node)) {
        items.push({ kind: "text", text: line });
      }
      continue;
    }
    if (name === "image") {
      const image = dataUri(node.attribs.href ?? node.attribs["xlink:href"] ?? "");
      if (image) {
        items.push({ kind: "image", ...image });
      }
      continue;
    }
    walk(node.children, items);
  }
}

/** A `<text>` element; a `<tspan>` positioned on its own (`x`, `y`, or `dy`) starts a new line. */
function textLines(text: Element): string[] {
  const lines: string[] = [];
  let current = "";
  const visit = (nodes: readonly AnyNode[]) => {
    for (const node of nodes) {
      if (isText(node)) {
        current += node.data;
      } else if (isTag(node) && !SKIPPED.has(localName(node.name))) {
        const startsLine = localName(node.name) === "tspan" && (node.attribs.y !== undefined || node.attribs.x !== undefined || Number.parseFloat(node.attribs.dy ?? "0") !== 0);
        if (startsLine && current.trim()) {
          lines.push(current);
          current = "";
        }
        visit(node.children);
      }
    }
  };
  visit(text.children);
  lines.push(current);
  return lines.map(collapse).filter(Boolean);
}

const BLOCK = new Set(["div", "p", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol"]);

function htmlLines(node: Element): string[] {
  let text = "";
  const visit = (nodes: readonly AnyNode[]) => {
    for (const child of nodes) {
      if (isText(child)) {
        text += child.data;
      } else if (isTag(child) && !SKIPPED.has(localName(child.name))) {
        const block = BLOCK.has(localName(child.name).toLowerCase());
        if (block) text += "\n";
        visit(child.children);
        if (block) text += "\n";
      }
    }
  };
  visit(node.children);
  return text.split("\n").map(collapse).filter(Boolean);
}

function dataUri(href: string): { data: Uint8Array; mediaType: string } | null {
  const match = /^data:([^;,]*)((?:;[^,]*)?),(.*)$/s.exec(href.trim());
  if (!match || !/;base64/i.test(match[2] ?? "")) {
    return null;
  }
  const data = Buffer.from((match[3] ?? "").replace(/\s+/g, ""), "base64");
  return data.length > 0 ? { data: new Uint8Array(data), mediaType: (match[1] ?? "").toLowerCase() } : null;
}

/**
 * `systemLanguage` shows an element only to matching user languages. Output must not depend on the machine,
 * so the drawing is read as an English-language renderer shows it: other variants, and the default.
 */
function languageMatches(node: Element): boolean {
  const languages = node.attribs.systemLanguage;
  return languages === undefined || languages.split(",").some((language) => /^en(-|$)/i.test(language.trim()));
}

function collapse(text: string): string {
  return text.replace(/[​﻿]/g, "").replace(/\s+/g, " ").trim();
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}
