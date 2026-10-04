import { expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { buildRootForwardSpec } from './editor';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { createRuntimePane } from './testSupport';

it('forwards selection and history annotations without changing their semantics', () => {
  const state = EditorState.create({ doc: 'alpha' });
  const transaction = state.update({ changes: { from: 5, insert: '!' }, selection: { anchor: 6 },
    annotations: [Transaction.userEvent.of('input.type'), Transaction.addToHistory.of(false), isolateHistory.of('full')] });
  const forwarded = state.update(buildRootForwardSpec(transaction));
  expect(forwarded.newSelection.main.head).toBe(6);
  expect(forwarded.annotation(Transaction.userEvent)).toBe('input.type');
  expect(forwarded.annotation(Transaction.addToHistory)).toBe(false);
  expect(forwarded.annotation(isolateHistory)).toBe('full');
});

it.each([['header', '# Heading', 4], ['unordered list', '- List item', 4], ['ordered list', '1. List item', 5]] as const)(
  'restores the deep %s caret through the owning runtime after a cursor-only move', (_label, line, offset) => {
    const doc = `intro\n${line}\noutro`; const position = 6 + offset;
    const runtime = new EditorDocumentRuntime(doc);
    try {
      const a = createRuntimePane(runtime, doc, 0), b = createRuntimePane(runtime, doc, 0);
      a.view.dispatch({ selection: { anchor: position } });
      a.view.dispatch({ changes: { from: position, insert: 'X' }, selection: { anchor: position + 1 }, annotations: isolateHistory.of('full') });
      expect(runtime.undo(b.controller.paneKey)).toBe(true);
      expect(b.view.state.doc.toString()).toBe(doc); expect(b.view.state.selection.main.head).toBe(position);
      expect(runtime.redo(a.controller.paneKey)).toBe(true);
      expect(a.view.state.doc.toString()).toBe(doc.slice(0, position) + 'X' + doc.slice(position));
      expect(a.view.state.selection.main.head).toBe(position + 1);
    } finally { runtime.destroy(); }
  });
