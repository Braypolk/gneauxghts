import { syntaxTree } from '@codemirror/language';
import { StateEffect, type EditorState, type Line } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

export type TableAlignment = 'left' | 'center' | 'right';
export interface TableCell { from: number; to: number; value: string }
export interface TableRow { from: number; to: number; cells: TableCell[] }
export interface MarkdownTable {
  from: number;
  to: number;
  source: string;
  rows: TableRow[];
  alignments: TableAlignment[];
}
export interface TableCellLocation { from: number; row: number; column: number }
export const tableSourceEffect = StateEffect.define<number | null>();
export const tableFocusEffect = StateEffect.define<TableCellLocation>();

/** Pipes escaped with an odd number of backslashes belong to the cell. */
export function tableRowCells(line: Pick<Line, 'from' | 'to' | 'text'>): TableCell[] {
  const { text } = line;
  const pipes: number[] = [];
  let backslashes = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '|' && backslashes % 2 === 0) pipes.push(index);
    backslashes = text[index] === '\\' ? backslashes + 1 : 0;
  }
  let start = 0, end = text.length;
  if (pipes.length && !text.slice(0, pipes[0]).trim()) start = pipes.shift()! + 1;
  if (pipes.length && !text.slice(pipes.at(-1)! + 1).trim()) end = pipes.pop()!;
  const boundaries = [start - 1, ...pipes, end];
  return boundaries.slice(1).map((boundary, index) => {
    const rawFrom = boundaries[index] + 1;
    const raw = text.slice(rawFrom, boundary);
    // One space on each edge frames the pipe syntax. Preserve any additional
    // whitespace as authored cell content: trimming it on every keystroke would
    // delete a just-typed space before the next word can be entered.
    const from = rawFrom + (raw.startsWith(' ') ? 1 : 0);
    const to = Math.max(from, boundary - (raw.endsWith(' ') ? 1 : 0));
    return { from: line.from + from, to: line.from + to, value: text.slice(from, to) };
  });
}

function parseTable(state: EditorState, node: SyntaxNode): MarkdownTable | null {
  const first = state.doc.lineAt(node.from), last = state.doc.lineAt(node.to);
  // Nested containers retain their ordinary Markdown editing. Rewriting their
  // prefixes as part of a table operation would change the enclosing block.
  if (node.parent?.name !== 'Document' || state.sliceDoc(first.from, node.from).trim()) return null;
  if (first.number + 1 > last.number) return null;
  const header = tableRowCells(first);
  const delimiters = tableRowCells(state.doc.line(first.number + 1));
  if (!header.length || header.length !== delimiters.length || delimiters.some(cell => !/^:?-+:?$/.test(cell.value.trim()))) return null;
  const rows: TableRow[] = [{ from: first.from, to: first.to, cells: header }];
  for (let number = first.number + 2; number <= last.number; number++) {
    const line = state.doc.line(number), cells = tableRowCells(line);
    // GFM silently discards extra cells. Keep that unusual source editable
    // instead of allowing a visual operation to erase authored content.
    if (cells.length > header.length) return null;
    rows.push({ from: line.from, to: line.to, cells });
  }
  return {
    from: first.from, to: last.to, source: state.sliceDoc(first.from, last.to), rows,
    alignments: delimiters.map(cell => cell.value.trim().startsWith(':') && cell.value.trim().endsWith(':') ? 'center' : cell.value.trim().endsWith(':') ? 'right' : 'left')
  };
}

/** Seek top-level siblings; never walk every inline node in a long note. */
export function markdownTables(state: EditorState, from = 0, to = state.doc.length): MarkdownTable[] {
  const result: MarkdownTable[] = [];
  const root = syntaxTree(state).topNode;
  for (let node = root.childAfter(from); node && node.from <= to; node = node.nextSibling) {
    if (node.name !== 'Table') continue;
    const table = parseTable(state, node);
    if (table) result.push(table);
  }
  return result;
}

export function tableValues(table: MarkdownTable): string[][] {
  return table.rows.map(row => table.alignments.map((_, column) => row.cells[column]?.value ?? ''));
}

export function escapeTableCell(value: string): string {
  // A cell is a single Markdown line. Flatten pasted line breaks rather than
  // letting input accidentally create a second block or an extra column.
  return value.replace(/[\r\n]+/g, ' ').replace(/(\\*)\|/g, (pipe, slashes: string) => slashes.length % 2 ? pipe : `${slashes}\\|`);
}

export function serializeTable(rows: readonly (readonly string[])[], alignments: readonly TableAlignment[]): string {
  const row = (values: readonly string[]) => `| ${alignments.map((_, column) => escapeTableCell(values[column] ?? '')).join(' | ')} |`;
  const delimiter = alignments.map(alignment => alignment === 'center' ? ':---:' : alignment === 'right' ? '---:' : '---');
  return [row(rows[0] ?? []), `| ${delimiter.join(' | ')} |`, ...rows.slice(1).map(row)].join('\n');
}
