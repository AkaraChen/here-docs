/**
 * Finds text taken from a PDF's text runs in the Markdown the extractor made of the same page. Whitespace may differ,
 * Markdown may have escaped punctuation, and line breaks, emphasis markers, or inline HTML (such as `<u>`) may sit
 * between words. A Latin text must start and end on word boundaries.
 */
export function textPattern(text: string): RegExp {
  const gap = "(?:\\s|</?[a-z]+>|[*_~]{1,2})+";
  let source = "";
  for (const char of text) {
    if (/\s/.test(char)) {
      if (!source.endsWith(gap)) source += gap;
    } else if (/[\\`*_{}[\]()#+\-.!|<>~]/.test(char)) {
      // Markdown may escape this punctuation.
      source += `\\\\?${escapeRegExp(char)}`;
    } else {
      source += escapeRegExp(char);
    }
  }
  const before = /^[\p{L}\p{N}]/u.test(text) && !isCjk(text[0]!) ? "(?<![\\p{L}\\p{N}])" : "";
  const after = /[\p{L}\p{N}]$/u.test(text) && !isCjk(text.at(-1)!) ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`${before}${source}${after}`, "gu");
}

export function isCjk(char: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
}

function escapeRegExp(char: string): string {
  return char.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}
