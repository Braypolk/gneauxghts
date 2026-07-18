export type DiffLineKind = 'context' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the base document, when applicable. */
  baseLine: number | null;
  /** 1-based line number in the proposed document, when applicable. */
  proposedLine: number | null;
}

export interface DiffHunk {
  lines: DiffLine[];
}

export interface NoteDiffModel {
  lines: DiffLine[];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** Document text to show in the editor (unified lines joined). */
  unifiedText: string;
}

/**
 * Myers-inspired line diff via LCS dynamic programming.
 * Fine for note-sized docs; keeps dependencies out of the tree.
 */
export function buildLineDiff(base: string, proposed: string): NoteDiffModel {
  const baseLines = splitLines(base);
  const proposedLines = splitLines(proposed);
  const lcs = computeLcsTable(baseLines, proposedLines);
  const lines = backtrackDiff(baseLines, proposedLines, lcs);

  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === 'added') additions += 1;
    if (line.kind === 'removed') deletions += 1;
  }

  return {
    lines,
    hunks: groupHunks(lines),
    additions,
    deletions,
    unifiedText: lines.map((line) => line.text).join('\n')
  };
}

export function buildCreateDiff(proposed: string): NoteDiffModel {
  return buildLineDiff('', proposed);
}

export function buildDeleteDiff(base: string): NoteDiffModel {
  return buildLineDiff(base, '');
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

function computeLcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length;
  const cols = b.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: cols + 1 }, () => 0)
  );
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      const row = table[i];
      const prevRow = table[i - 1];
      if (!row || !prevRow) continue;
      if (a[i - 1] === b[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }
  return table;
}

function backtrackDiff(a: string[], b: string[], table: number[][]): DiffLine[] {
  const lines: DiffLine[] = [];
  let i = a.length;
  let j = b.length;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({
        kind: 'context',
        text: a[i - 1] ?? '',
        baseLine: i,
        proposedLine: j
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || (table[i]?.[j - 1] ?? 0) >= (table[i - 1]?.[j] ?? 0))) {
      stack.push({
        kind: 'added',
        text: b[j - 1] ?? '',
        baseLine: null,
        proposedLine: j
      });
      j -= 1;
    } else if (i > 0) {
      stack.push({
        kind: 'removed',
        text: a[i - 1] ?? '',
        baseLine: i,
        proposedLine: null
      });
      i -= 1;
    } else {
      break;
    }
  }

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const line = stack[index];
    if (line) lines.push(line);
  }
  return lines;
}

function groupHunks(lines: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  let trailingContext = 0;

  const flush = () => {
    if (current.length === 0) return;
    // Trim trailing context-only runs that were carried after a change.
    while (trailingContext > 0 && current.length > 0) {
      const last = current[current.length - 1];
      if (last?.kind === 'context') {
        current.pop();
        trailingContext -= 1;
      } else {
        break;
      }
    }
    if (current.some((line) => line.kind !== 'context')) {
      hunks.push({ lines: current });
    }
    current = [];
    trailingContext = 0;
  };

  for (const line of lines) {
    if (line.kind === 'context') {
      if (current.length === 0) {
        // Leading context before first change — skip for hunk grouping.
        continue;
      }
      current.push(line);
      trailingContext += 1;
      if (trailingContext > 3) {
        flush();
      }
    } else {
      trailingContext = 0;
      current.push(line);
    }
  }
  flush();
  return hunks;
}
