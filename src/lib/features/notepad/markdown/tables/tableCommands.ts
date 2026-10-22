import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { escapeTableCell, markdownTables, serializeTable, tableFocusEffect, tableValues, type MarkdownTable, type TableAlignment } from './tableModel';

function currentTable(view: EditorView, table: MarkdownTable) {
  if (view.state.readOnly || view.composing) return null;
  return markdownTables(view.state, table.from, table.from).find(current => current.from === table.from && current.source === table.source) ?? null;
}

export function editTableCell(view: EditorView, table: MarkdownTable, row: number, column: number, value: string): boolean {
  const current = currentTable(view, table);
  if (!current || !current.rows[row] || column < 0 || column >= current.alignments.length) return false;
  const cell = current.rows[row].cells[column], insert = escapeTableCell(value);
  if (cell?.value === insert) return true;
  if (cell) {
    view.dispatch({ changes: { from: cell.from, to: cell.to, insert }, userEvent: 'input.type.table' });
  } else {
    const values = tableValues(current);
    values[row][column] = insert;
    replaceTable(view, current, values, current.alignments, row, column);
  }
  return true;
}

function replaceTable(view: EditorView, table: MarkdownTable, rows: string[][], alignments: TableAlignment[], row: number, column: number) {
  view.dispatch({
    changes: { from: table.from, to: table.to, insert: serializeTable(rows, alignments) },
    effects: tableFocusEffect.of({ from: table.from, row, column }),
    annotations: isolateHistory.of('full'), userEvent: 'input.table'
  });
}

export type TableOperation = 'addRow' | 'removeRow' | 'addColumn' | 'removeColumn' | TableAlignment;

export function changeTable(view: EditorView, table: MarkdownTable, operation: TableOperation, row: number, column: number): boolean {
  const current = currentTable(view, table);
  if (!current) return false;
  const rows = tableValues(current), alignments = [...current.alignments];
  row = Math.max(0, Math.min(row, rows.length - 1));
  column = Math.max(0, Math.min(column, alignments.length - 1));
  switch (operation) {
    case 'addRow': rows.splice(++row, 0, alignments.map(() => '')); break;
    case 'removeRow':
      if (row === 0) return false;
      rows.splice(row, 1); row = Math.min(row, rows.length - 1); break;
    case 'addColumn':
      column++; alignments.splice(column, 0, 'left');
      for (const values of rows) values.splice(column, 0, '');
      break;
    case 'removeColumn':
      if (alignments.length === 1) return false;
      alignments.splice(column, 1);
      for (const values of rows) values.splice(column, 1);
      column = Math.min(column, alignments.length - 1); break;
    default:
      if (alignments[column] === operation) return false;
      alignments[column] = operation;
  }
  replaceTable(view, current, rows, alignments, row, column);
  return true;
}

export function insertMarkdownTable(view: EditorView, token?: { from: number; to: number }): boolean {
  if (view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1) return false;
  const selection = view.state.selection.main;
  const from = token?.from ?? selection.from, to = token?.to ?? selection.to;
  const before = view.state.sliceDoc(0, from), after = view.state.sliceDoc(to);
  const prefix = before.length ? before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n' : '';
  const suffix = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const source = serializeTable([['Column 1', 'Column 2'], ['', '']], ['left', 'left']);
  const tableFrom = from + prefix.length;
  view.dispatch({ changes: { from, to, insert: prefix + source + suffix },
    selection: { anchor: tableFrom + source.length + suffix.length },
    effects: tableFocusEffect.of({ from: tableFrom, row: 0, column: 0 }),
    userEvent: 'input.table', annotations: isolateHistory.of('full') });
  view.focus();
  return true;
}
