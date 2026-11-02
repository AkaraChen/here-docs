import type { PdfPageItem } from "../types.js";
import { textPattern } from "./locate.js";

/**
 * Removes each run's text (its first occurrence) from a page's Markdown, then drops lines left holding only markup,
 * such as a heading marker whose text was removed.
 */
export function removeRuns(markdown: string, runs: readonly PdfPageItem[]): string {
  let result = markdown;
  let removed = false;
  for (const run of runs) {
    const text = run.text.trim();
    const match = text ? textPattern(text).exec(result) : null;
    if (!match) {
      continue;
    }
    let start = match.index;
    const end = start + match[0].length;
    // Do not leave a double space where the run was.
    if (result[start - 1] === " " && (end === result.length || /\s/.test(result[end]!))) {
      start -= 1;
    }
    result = result.slice(0, start) + result.slice(end);
    removed = true;
  }
  if (!removed) {
    return markdown;
  }
  return result
    .split("\n")
    .filter((line) => !/^\s*(#{1,6}|[-*+]|>|\d+[.)])\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
