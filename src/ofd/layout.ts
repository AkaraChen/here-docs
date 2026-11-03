/** A run of text placed on a page, in millimetres: `x`/`y` is the start of the baseline. */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
}

/**
 * Reading order for positioned text: runs are grouped into lines by baseline, lines go top to bottom,
 * and runs in a line go left to right with a space where the gap is wider than about half a glyph.
 */
export function layoutLines(runs: readonly TextRun[]): string[] {
  const unique = dedupe(runs);
  const sorted = [...unique].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Array<{ y: number; size: number; runs: TextRun[] }> = [];
  for (const run of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate.y - run.y) <= 0.5 * Math.max(candidate.size, run.size));
    if (line) {
      line.runs.push(run);
    } else {
      lines.push({ y: run.y, size: run.size, runs: [run] });
    }
  }
  return lines
    .sort((a, b) => a.y - b.y)
    .map((line) => joinRuns(line.runs.sort((a, b) => a.x - b.x)))
    .filter((text) => text.length > 0);
}

function joinRuns(runs: readonly TextRun[]): string {
  let out = "";
  let end = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    if (out && run.x - end > 0.5 * run.size && !out.endsWith(" ")) {
      out += " ";
    }
    out += run.text;
    end = Math.max(end, run.x + run.width);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Producers sometimes draw the same text twice (fake bold, template and page overlap). */
function dedupe(runs: readonly TextRun[]): TextRun[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    const key = `${run.text}@${run.x.toFixed(1)},${run.y.toFixed(1)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
