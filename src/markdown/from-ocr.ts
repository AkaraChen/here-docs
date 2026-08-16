import type { OcrLine } from "../types.js";

export function linesToMarkdown(lines: readonly OcrLine[]): string {
  const text = lines
    .map((line) => line.text.trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return text.length > 0 ? `${text}\n` : "";
}

export function pageMarkdown(pageNumber: number, lines: readonly OcrLine[]): string {
  const body = linesToMarkdown(lines).trimEnd();
  if (!body) {
    return `## Page ${pageNumber}\n`;
  }
  return `## Page ${pageNumber}\n\n${body}\n`;
}
