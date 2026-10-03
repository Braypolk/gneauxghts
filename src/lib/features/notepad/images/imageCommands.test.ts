import { Compartment, EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { EditorDocumentRuntime } from '../editor/editorDocumentRuntime';
import type { EditorController } from '../editor/types';
import { imageState } from './imageState';
import { resizeRenderedImage } from './imageEmbeds';
function pane(runtime: EditorDocumentRuntime, markdown: string, anchor: number, readOnly = false) {
  let state = EditorState.create({ doc: markdown, selection: { anchor }, extensions: [imageState, EditorState.readOnly.of(readOnly)] });
  const view = {
    get state() { return state; },
    composing: false,
    update(transactions: readonly Transaction[]) { for (const transaction of transactions) state = transaction.state; },
    dispatch(spec: TransactionSpec) { runtime.dispatchFromPane(controller, [state.update(spec)]); },
    scrollDOM: { scrollTop: 123, scrollLeft: 0 }
  } as unknown as EditorView;
  const onMarkdownChange = vi.fn();
  const controller: EditorController = { view, runtime, sharedResources: null, paneKey: Symbol('pane'), onMarkdownChange, proposalReviewCompartment: new Compartment() };
  runtime.attachController(controller); return { view, controller, onMarkdownChange };
}
describe('authored image edits through shared undo', () => {
  it('broadcasts a source-preserving resize and one undo across sibling panes', () => {
    const original = 'Before\n\n![Citrus|200](a%20b.png "Title")\n\nAfter';
    const runtime = new EditorDocumentRuntime(original), a = pane(runtime, original, 8), b = pane(runtime, original, 0);
    resizeRenderedImage(a.view, a.view.state.field(imageState).images[0], 450);
    expect(runtime.markdown).toBe(original.replace('|200', '|450'));
    expect(b.view.state.doc.toString()).toBe(runtime.markdown);
    expect(b.view.state.selection.main.anchor).toBe(0);
    expect(b.view.scrollDOM.scrollTop).toBe(123);
    expect(a.onMarkdownChange).toHaveBeenCalledTimes(1);
    expect(runtime.undo(b.controller.paneKey)).toBe(true);
    expect(a.view.state.doc.toString()).toBe(original);
    expect(runtime.undo(b.controller.paneKey)).toBe(false);
  });
  it('rejects a stale image target and read-only or composing mutations', () => {
    const original = '![[a.png|200]]';
    const runtime = new EditorDocumentRuntime(original), a = pane(runtime, original, 0), readonly = pane(runtime, original, 0, true);
    const stale = a.view.state.field(imageState).images[0];
    resizeRenderedImage(readonly.view, stale, 400); expect(runtime.markdown).toBe(original);
    a.view.dispatch({ changes: { from: 3, to: 4, insert: 'b' } });
    resizeRenderedImage(a.view, stale, 400); expect(runtime.markdown).toBe('![[b.png|200]]');
    Object.defineProperty(a.view, 'composing', { value: true });
    resizeRenderedImage(a.view, a.view.state.field(imageState).images[0], 400); expect(runtime.markdown).toBe('![[b.png|200]]');
  });
  it('keeps independent text and multiple-range selection semantics', () => {
    const original = 'Text ![[a.png|200]] more';
    const runtime = new EditorDocumentRuntime(original), a = pane(runtime, original, 0);
    const next = EditorState.create({ doc: original, extensions: [imageState, EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(original.length)]) });
    a.view.update([a.view.state.update({ effects: [] })]);
    Object.defineProperty(a.view, 'state', { value: next });
    resizeRenderedImage(a.view, next.field(imageState).images[0], 400);
    expect(runtime.markdown).toBe(original);
  });
});

it('does not dispatch an unchanged resize', () => {
  const original = '![[a.png|200]]';
  const runtime = new EditorDocumentRuntime(original), a = pane(runtime, original, 0);
  resizeRenderedImage(a.view, a.view.state.field(imageState).images[0], 200);
  expect(a.onMarkdownChange).not.toHaveBeenCalled();
  expect(runtime.undo(a.controller.paneKey)).toBe(false);
});
it('groups a keyboard sizing burst separately from adjacent typing and gestures', () => {
  const original = '![[a.png|200]]';
  const runtime = new EditorDocumentRuntime(original), a = pane(runtime, original, 0);
  a.view.dispatch({ changes: { from: original.length, insert: ' text' }, annotations: Transaction.userEvent.of('input.type') });
  for (const width of [250, 300, 350]) resizeRenderedImage(a.view, a.view.state.field(imageState).images[0], width, true);
  a.view.dispatch({ changes: { from: a.view.state.doc.length, insert: ' more' }, annotations: Transaction.userEvent.of('input.type') });
  expect(runtime.undo(a.controller.paneKey)).toBe(true);
  expect(runtime.markdown).toBe('![[a.png|350]] text');
  expect(runtime.undo(a.controller.paneKey)).toBe(true);
  expect(runtime.markdown).toBe('![[a.png|200]] text');
  expect(runtime.undo(a.controller.paneKey)).toBe(true);
  expect(runtime.markdown).toBe(original);
});
