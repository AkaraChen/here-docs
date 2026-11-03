import type { OcrLine } from "../types.js";

export function linesToMarkdown(lines: readonly OcrLine[]): string {
  const text = lines
    .map((line) => line.text.trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return text.length > 0 ? `${text}\n` : "";
}

/** A page with no recognized text (a blank page) has no Markdown at all, not a heading without a body. */
export function pageMarkdown(pageNumber: number, lines: readonly OcrLine[]): string {
  const body = linesToMarkdown(lines).trimEnd();
  if (!body) {
    return "";
  }
  return `## Page ${pageNumber}\n\n${body}\n`;
}
