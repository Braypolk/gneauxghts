import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { markdownTables, tableFocusEffect, tableSourceEffect, type MarkdownTable } from './tableModel';
import { focusTableCell, MarkdownTableWidget, TableSourceDoneWidget } from './tableWidget';

function decorations(state: EditorState, tables: MarkdownTable[], sourceFrom: number | null) {
  return Decoration.set(tables.map(table => sourceFrom === table.from
    ? Decoration.widget({ widget: new TableSourceDoneWidget(table.from, table.to), block: true, side: 1 }).range(table.to)
    : Decoration.replace({ widget: new MarkdownTableWidget(table, state.readOnly), block: true }).range(table.from, table.to)), true);
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

export function createTableExtension() {
  return [tablePresentation,
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
