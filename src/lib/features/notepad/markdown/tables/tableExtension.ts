import { syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorState, StateField, type ChangeSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { markdownTables, tableFocusEffect, tableSourceEffect, type MarkdownTable } from './tableModel';
import { focusTableCell, MarkdownTableWidget, TableSourceDoneWidget } from './tableWidget';

function decorations(state: EditorState, tables: MarkdownTable[], sourceFrom: number | null) {
  return Decoration.set(tables.map(table => sourceFrom === table.from
    ? Decoration.widget({ widget: new TableSourceDoneWidget(table.from, table.to), block: true, side: 1 }).range(table.to)
    // The first blank separator belongs to the rendered block's spacing. Hide
    // it so adding Markdown separation on input does not move the typing line.
    : Decoration.replace({ widget: new MarkdownTableWidget(table, state.readOnly), block: true })
      .range(table.from, table.to + (state.sliceDoc(table.to, table.to + 2) === '\n\n' ? 1 : 0))), true);
}

function hasPipe(text: import('@codemirror/state').Text) {
  for (const chunk of text) if (chunk.includes('|')) return true;
  return false;
}

export const tablePresentation = StateField.define({
  create(state) {
    const possibleTables = hasPipe(state.doc);
    const tables = possibleTables ? markdownTables(state) : [];
    return { tables, possibleTables, sourceFrom: null as number | null, tree: syntaxTree(state), decorations: decorations(state, tables, null) };
  },
  update(value, tr) {
    let tables = value.tables;
    const tree = syntaxTree(tr.state);
    let possibleTables = value.possibleTables;
    if (tr.isUserEvent('input.external-reset')) possibleTables = hasPipe(tr.newDoc);
    else if (!possibleTables && tr.docChanged) tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (hasPipe(inserted)) possibleTables = true;
    });
    let sourceFrom = value.sourceFrom == null ? null : tr.changes.mapPos(value.sourceFrom, -1);
    // A fence edit can expose or absorb distant tables. The published syntax
    // tree is authoritative; seeking its top-level siblings skips inline
    // content without retaining widgets from an obsolete block interpretation.
    if (tr.docChanged || tree !== value.tree || tr.reconfigured) tables = possibleTables ? markdownTables(tr.state) : tables.length ? [] : tables;
    for (const effect of tr.effects) if (effect.is(tableSourceEffect)) sourceFrom = effect.value;
    if (tr.isUserEvent('input.external-reset')) sourceFrom = null;
    const source = tables.find(table => table.from === sourceFrom), selection = tr.newSelection.main;
    if (source && (selection.to < source.from || selection.from > source.to)) sourceFrom = null;
    if (tables === value.tables && possibleTables === value.possibleTables && sourceFrom === value.sourceFrom && !tr.reconfigured && tr.state.readOnly === tr.startState.readOnly) return value;
    return { tables, possibleTables, sourceFrom, tree, decorations: decorations(tr.state, tables, sourceFrom) };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations)
});

const separateTableParagraph = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.startState.readOnly ||
    !(tr.isUserEvent('input.type') || tr.isUserEvent('input.paste')) || tr.isUserEvent('input.type.table')) return tr;
  const { tables, sourceFrom } = tr.startState.field(tablePresentation);
  const separators: ChangeSpec[] = [];
  tr.changes.iterChanges((from, to, newFrom, _newTo, inserted) => {
    if (from !== to || !inserted.line(1).length) return;
    const line = tr.startState.doc.lineAt(from);
    if (line.number === 1 || line.text.trim()) return;
    const previousEnd = tr.startState.doc.line(line.number - 1).to;
    if (tables.some(table => table.from !== sourceFrom && table.to === previousEnd)) {
      separators.push({ from: newFrom, insert: '\n' });
    }
  });
  if (!separators.length) return tr;
  // GFM absorbs a nonempty line immediately after a table as another row.
  // Author the paragraph boundary with the input so rendering never swallows
  // the caret, and the existing document root records a single undoable edit.
  const changes = ChangeSet.of(separators, tr.newDoc.length);
  return [tr, { changes, selection: tr.newSelection.map(changes), sequential: true }];
});

export function createTableExtension() {
  return [tablePresentation, separateTableParagraph,
    EditorView.atomicRanges.of(view => view.state.field(tablePresentation).decorations),
    ViewPlugin.fromClass(class {
      alive = true;
      constructor(readonly view: EditorView) {}
      update(update: import('@codemirror/view').ViewUpdate) {
        for (const tr of update.transactions) for (const effect of tr.effects) if (effect.is(tableFocusEffect)) {
          const doc = update.state.doc, location = effect.value;
          queueMicrotask(() => {
            if (this.alive && this.view.state.doc === doc) focusTableCell(this.view, location);
          });
        }
      }
      destroy() { this.alive = false; }
    })
  ];
}
