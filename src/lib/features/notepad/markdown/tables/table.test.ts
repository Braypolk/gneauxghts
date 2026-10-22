import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { createCommandView } from '../../editor/commandTestSupport';
import { EditorDocumentRuntime } from '../../editor/editorDocumentRuntime';
import { createRuntimePane } from '../../editor/testSupport';
import { describeBlockAt, listBlocks, moveBlockTo } from '../../editor/blockTypes';
import { createMarkdownExtensions } from '../markdownExtensions';
import { changeTable, editTableCell, insertMarkdownTable } from './tableCommands';
import { tablePresentation } from './tableExtension';
import { escapeTableCell, markdownTables, serializeTable, tableSourceEffect, tableValues } from './tableModel';

const source = '| Name | Value |\n| --- | ---: |\n| **One** | 1 |\n| Two | 2 |';
const extensions = () => [createMarkdownExtensions(), history()];
const table = (state: EditorState) => markdownTables(state)[0];

describe('portable Markdown tables', () => {
  it('reads optional outer pipes, alignments, escaped pipes and missing cells without losing source', () => {
    const doc = 'Name | Value | Other\n:--- | :---: | ---:\nA\\|B | `code`\n';
    const state = EditorState.create({ doc, extensions: extensions() });
    const ref = table(state);
    expect(ref.alignments).toEqual(['left', 'center', 'right']);
    expect(tableValues(ref)).toEqual([['Name', 'Value', 'Other'], ['A\\|B', '`code`', '']]);
    expect(ref.source + '\n').toBe(doc);
    expect(state.sliceDoc(ref.rows[1].cells[0].from, ref.rows[1].cells[0].to)).toBe('A\\|B');
    const padded = EditorState.create({ doc: '|  A  | B |\n|  :---:  | ---: |\n| x | y |', extensions: extensions() });
    expect(table(padded).alignments).toEqual(['center', 'right']);
  });

  it('keeps nested and extra-cell table source intact instead of dropping content in a visual edit', () => {
    for (const doc of ['> | A | B |\n> | --- | --- |\n> | x | y |', '| A | B |\n| --- | --- |\n| x | y | extra |']) {
      const state = EditorState.create({ doc, extensions: extensions() });
      expect(markdownTables(state)).toEqual([]);
      expect(state.doc.toString()).toBe(doc);
    }
  });

  it('escapes typed pipes and flattens pasted newlines without double escaping', () => {
    expect(escapeTableCell('A|B\nC')).toBe('A\\|B C');
    expect(escapeTableCell('A\\|B')).toBe('A\\|B');
    expect(escapeTableCell('A\\\\|B')).toBe('A\\\\\\|B');
    expect(serializeTable([['A', 'B'], ['left|right', 'x']], ['center', 'right'])).toBe('| A | B |\n| :---: | ---: |\n| left\\|right | x |');
  });

  it('edits only a cell span and retains surrounding spacing, with ordinary undo', () => {
    const doc = '|  A  | B |\n| --- | --- |\n| one | two |';
    const { view } = createCommandView({ doc, extensions: extensions() });
    expect(editTableCell(view, table(view.state), 0, 0, 'New|Name')).toBe(true);
    expect(view.state.doc.toString()).toBe('| New\\|Name | B |\n| --- | --- |\n| one | two |');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('retains a just-typed trailing space through the canonical document before the next word', () => {
    const { view } = createCommandView({ doc: source, extensions: extensions() });
    editTableCell(view, table(view.state), 1, 0, 'hello ');
    expect(table(view.state).rows[1].cells[0].value).toBe('hello ');
    editTableCell(view, table(view.state), 1, 0, 'hello world');
    expect(tableValues(table(view.state))[1][0]).toBe('hello world');
  });

  it('fills a missing cell through a portable rectangular row', () => {
    const { view } = createCommandView({ doc: '| A | B |\n| --- | --- |\n| one |', extensions: extensions() });
    expect(editTableCell(view, table(view.state), 1, 1, 'two')).toBe(true);
    expect(tableValues(table(view.state))).toEqual([['A', 'B'], ['one', 'two']]);
  });

  it('adds/removes rows and columns around the selected cell, retaining the header and one column', () => {
    const { view } = createCommandView({ doc: source, extensions: extensions() });
    expect(changeTable(view, table(view.state), 'addRow', 1, 0)).toBe(true);
    expect(tableValues(table(view.state))[2]).toEqual(['', '']);
    expect(changeTable(view, table(view.state), 'addColumn', 2, 0)).toBe(true);
    expect(tableValues(table(view.state))[0]).toEqual(['Name', '', 'Value']);
    expect(changeTable(view, table(view.state), 'removeColumn', 2, 1)).toBe(true);
    expect(changeTable(view, table(view.state), 'removeRow', 2, 0)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(changeTable(view, table(view.state), 'removeRow', 0, 0)).toBe(false);
    expect(changeTable(view, table(view.state), 'center', 1, 0)).toBe(true);
    expect(table(view.state).alignments).toEqual(['center', 'right']);
    const single = createCommandView({ doc: '| A |\n| --- |\n| x |', extensions: extensions() }).view;
    expect(changeTable(single, table(single.state), 'removeColumn', 0, 0)).toBe(false);
  });

  it('rejects stale references and readonly changes', () => {
    const { view } = createCommandView({ doc: source, extensions: extensions() });
    const stale = table(view.state);
    editTableCell(view, stale, 1, 0, 'new');
    expect(editTableCell(view, stale, 1, 0, 'stale')).toBe(false);
    const readOnly = createCommandView({ doc: source, extensions: [extensions(), EditorState.readOnly.of(true)] }).view;
    expect(editTableCell(readOnly, table(readOnly.state), 1, 0, 'new')).toBe(false);
    expect(changeTable(readOnly, table(readOnly.state), 'addRow', 0, 0)).toBe(false);
    expect(insertMarkdownTable(readOnly)).toBe(false);
  });

  it('inserts at a slash token or block handle with safe block separation and one undo', () => {
    const { view } = createCommandView({ doc: 'before\n/table\nafter', extensions: extensions() });
    insertMarkdownTable(view, { from: 7, to: 13 });
    expect(view.state.doc.toString()).toContain('before\n\n| Column 1 | Column 2 |');
    expect(view.state.doc.toString()).toContain('|  |  |\n\nafter');
    expect(view.state.field(tablePresentation).tables).toHaveLength(1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('before\n/table\nafter');
  });

  it('maps untouched tables and refreshes only edited table siblings', () => {
    const doc = `before\n\n${source}\n\n${source}\n\nafter`;
    const { view } = createCommandView({ doc, extensions: extensions() });
    view.dispatch({ changes: { from: 0, insert: 'new ' } });
    expect(view.state.field(tablePresentation).tables).toEqual(markdownTables(view.state));
    const refs = markdownTables(view.state);
    editTableCell(view, refs[1], 1, 0, 'updated');
    expect(view.state.field(tablePresentation).tables).toEqual(markdownTables(view.state));
    view.dispatch({ changes: { from: refs[0].from, to: refs[0].to, insert: 'paragraph' } });
    expect(view.state.field(tablePresentation).tables).toEqual(markdownTables(view.state));
    expect(markdownTables(view.state)).toHaveLength(1);
  });

  it('removes widgets absorbed by an earlier fence and restores distant tables exposed by removing it', () => {
    const { view } = createCommandView({ doc: `before\n\n${source}`, extensions: extensions() });
    view.dispatch({ changes: { from: 0, insert: '```\n' } });
    expect(view.state.field(tablePresentation).tables).toEqual([]);
    view.dispatch({ changes: { from: 0, to: 4 } });
    expect(view.state.field(tablePresentation).tables).toEqual(markdownTables(view.state));
    expect(view.state.field(tablePresentation).tables).toHaveLength(1);
  });

  it('keeps long pipe-free prose outside table inventory until an inserted pipe can introduce a table', () => {
    const doc = Array.from({ length: 1000 }, (_, index) => `Paragraph ${index}\n`).join('\n');
    const { view } = createCommandView({ doc, extensions: extensions() });
    expect(view.state.field(tablePresentation).possibleTables).toBe(false);
    view.dispatch({ changes: { from: 3, insert: 'ordinary typing' } });
    expect(view.state.field(tablePresentation).possibleTables).toBe(false);
    view.dispatch({ changes: { from: 0, insert: source + '\n\n' } });
    expect(view.state.field(tablePresentation).possibleTables).toBe(true);
    expect(view.state.field(tablePresentation).tables).toHaveLength(1);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'clean prose' }, userEvent: 'input.external-reset' });
    expect(view.state.field(tablePresentation).possibleTables).toBe(false);
    expect(view.state.field(tablePresentation).tables).toEqual([]);
    view.dispatch({ changes: { from: 0, insert: 'stray | pipe\n\n' } });
    expect(view.state.field(tablePresentation).possibleTables).toBe(true);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'plain text' }, userEvent: 'input.external-reset' });
    expect(view.state.field(tablePresentation).possibleTables).toBe(false);
  });

  it('keeps raw source until explicitly done or the selection leaves the table', () => {
    const { view } = createCommandView({ doc: source + '\n\noutside', extensions: extensions() });
    view.dispatch({ selection: { anchor: 3 }, effects: tableSourceEffect.of(0) });
    expect(view.state.field(tablePresentation).sourceFrom).toBe(0);
    view.dispatch({ changes: { from: 3, insert: 'new ' } });
    expect(view.state.field(tablePresentation).sourceFrom).toBe(0);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(view.state.field(tablePresentation).sourceFrom).toBeNull();
  });

  it('keeps typing and paste below a rendered table in a separate paragraph with normal undo', () => {
    for (const ending of ['\n', '\n\n']) for (const userEvent of ['input.type', 'input.paste']) {
      const doc = source + ending;
      const { view } = createCommandView({ doc, selection: { anchor: doc.length }, extensions: extensions() });
      view.dispatch({ changes: { from: doc.length, insert: 'hello' },
        selection: { anchor: doc.length + 5 }, userEvent });
      expect(view.state.doc.toString()).toBe(source + '\n\nhello');
      expect(table(view.state).source).toBe(source);
      expect(view.state.selection.main.head).toBe(view.state.doc.length);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
    }
  });

  it('preserves intentional source and cell edits at the end of a table', () => {
    const doc = 'Name | Value\n--- | ---\nOne | 1';
    const { view } = createCommandView({ doc, extensions: extensions() });
    editTableCell(view, table(view.state), 1, 1, '123');
    expect(view.state.doc.toString()).toBe(doc + '23');
    view.dispatch({ effects: tableSourceEffect.of(0) });
    view.dispatch({ changes: { from: view.state.doc.length, insert: '4' }, userEvent: 'input.type' });
    expect(view.state.doc.toString()).toBe(doc + '234');
  });

  it('shares edits and undo across sibling panes using the existing document root', () => {
    const runtime = new EditorDocumentRuntime(source);
    try {
      const first = createRuntimePane(runtime, source, 0, vi.fn(), createMarkdownExtensions());
      const second = createRuntimePane(runtime, source, source.length, vi.fn(), createMarkdownExtensions());
      editTableCell(first.view, table(first.readState()), 1, 0, '**updated**');
      expect(tableValues(table(second.readState()))[1][0]).toBe('**updated**');
      changeTable(second.view, table(second.readState()), 'addColumn', 1, 0);
      expect(table(first.readState()).alignments).toHaveLength(3);
      expect(runtime.undo(first.controller.paneKey)).toBe(true);
      expect(table(first.readState()).alignments).toHaveLength(2);
      expect(runtime.undo(second.controller.paneKey)).toBe(true);
      expect(runtime.markdown).toBe(source);
      expect(first.readState().doc.toString()).toBe(source);
      expect(second.readState().doc.toString()).toBe(source);
    } finally { runtime.destroy(); }
  });

  it('shares the new paragraph below a table and undoes its separator as part of the input', () => {
    const doc = source + '\n';
    const runtime = new EditorDocumentRuntime(doc);
    try {
      const first = createRuntimePane(runtime, doc, doc.length, vi.fn(), createMarkdownExtensions());
      const second = createRuntimePane(runtime, doc, 0, vi.fn(), createMarkdownExtensions());
      first.view.dispatch({ changes: { from: doc.length, insert: 'hello' },
        selection: { anchor: doc.length + 5 }, userEvent: 'input.type' });
      expect(runtime.markdown).toBe(source + '\n\nhello');
      expect(second.readState().doc.toString()).toBe(runtime.markdown);
      expect(table(second.readState()).source).toBe(source);
      expect(first.readState().selection.main.head).toBe(runtime.markdown.length);
      expect(runtime.undo(first.controller.paneKey)).toBe(true);
      expect(runtime.markdown).toBe(doc);
      expect(second.readState().doc.toString()).toBe(doc);
    } finally { runtime.destroy(); }
  });

  it('moves the complete rendered table from any source row and keeps undo portable', () => {
    const doc = `before\n\n${source}\n\nafter`;
    const { view } = createCommandView({ doc, extensions: extensions() });
    const ref = table(view.state);
    const descriptor = describeBlockAt(view.state, ref.rows[2].cells[0].from);
    expect(descriptor.from).toBe(ref.from);
    expect(descriptor.to).toBe(ref.to);
    expect(listBlocks(view.state).filter(block => block.from >= ref.from && block.to <= ref.to)).toHaveLength(1);
    const target = describeBlockAt(view.state, 0);
    moveBlockTo(view, descriptor, target, true);
    expect(view.state.doc.toString()).toContain(source);
    expect(markdownTables(view.state)).toHaveLength(1);
    expect(tableValues(table(view.state))[2]).toEqual(['Two', '2']);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
