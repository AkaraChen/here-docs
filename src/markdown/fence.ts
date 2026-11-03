/** A fenced code block whose fence is longer than any backtick run inside the code. */
export function fence(code: string, lang = ""): string {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${code.replace(/\n+$/, "")}\n${ticks}`;
}
