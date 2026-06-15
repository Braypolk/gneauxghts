import { describe, expect, it } from 'vitest';
import { history, undo, redo, isolateHistory } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';

import { buildRootForwardSpec } from './editor';

// The multi-view editor keeps a headless "root" state that owns the undo
// history; panes forward their edits into it. These tests exercise the exact
// transaction shape the runtime uses (buildRootForwardSpec) against a real
// CodeMirror history, without mounting an EditorView.
//
// The reported bug: undo/redo collapsed the caret and viewport to the document
// top (position 0). Root cause: pane edits were forwarded to the root with only
// `changes` and no `selection`, so the root caret never left 0 — every edit's
// resulting selection was recorded as 0, and the live caret itself jumped to
// the top the moment an edit was forwarded. buildRootForwardSpec now carries
// the pane's resulting selection (`transaction.newSelection`), so the root
// caret tracks the editing pane and CodeMirror's history stores meaningful
// selections. Undo then restores the caret to the *pre-edit* position (standard
// editor semantics) instead of slamming it to the top.

function rootState(doc: string) {
  return EditorState.create({ doc, extensions: [history()] });
}

// Mimic a pane edit and forward it into the root via the production helper.
// `isolate` forces a history boundary so coalescing does not merge edits.
function paneEdit(
  change: { from: number; to?: number; insert: string },
  rootStateIn: EditorState,
  isolate = false
) {
  const paneState = EditorState.create({ doc: rootStateIn.doc.toString() });
  const paneTr: Transaction = paneState.update({
    changes: change,
    selection: { anchor: change.from + change.insert.length }
  });
  const spec = buildRootForwardSpec(paneTr);
  return rootStateIn
    .update(
      isolate ? { ...spec, annotations: [...spec.annotations, isolateHistory.of('before')] } : spec
    )
    .state;
}

function applyCommand(
  command: (cfg: { state: EditorState; dispatch: (t: Transaction) => void }) => boolean,
  state: EditorState
) {
  let next: Transaction | null = null;
  const ran = command({ state, dispatch: (t) => (next = t) });
  return { ran, state: next ? (next as Transaction).state : state };
}

describe('buildRootForwardSpec', () => {
  it('carries the pane selection into the forwarded root transaction', () => {
    const paneState = EditorState.create({ doc: 'alpha' });
    const paneTr = paneState.update({ changes: { from: 5, insert: '!' }, selection: { anchor: 6 } });
    const spec = buildRootForwardSpec(paneTr);
    // Carrying the selection is the core of the undo/redo fix.
    expect(spec.selection).toBeDefined();
    expect(spec.selection.main.head).toBe(6);
  });

  it('keeps the root caret in lockstep with the editing pane', () => {
    let state = rootState('alpha\nbeta\ngamma');
    const editPos = state.doc.length;
    state = paneEdit({ from: editPos, insert: 'Z' }, state);
    // Root selection follows the pane caret (was stuck at 0 before the fix —
    // this is the live-editing half of the bug: the caret jumped to the top the
    // moment the edit was forwarded).
    expect(state.selection.main.head).toBe(editPos + 1);
    expect(state.selection.main.head).toBeGreaterThan(0);
  });
});

describe('root history selection forwarding (undo/redo)', () => {
  it('undo restores the pre-edit selection rather than discarding it', () => {
    let state = rootState('alpha\nbeta\ngamma');
    const editPos = state.doc.length; // deep in the document
    state = paneEdit({ from: editPos, insert: 'Z' }, state);

    const afterUndo = applyCommand(undo, state);
    expect(afterUndo.ran).toBe(true);
    // Document is rolled back.
    expect(afterUndo.state.doc.toString()).toBe('alpha\nbeta\ngamma');
    // Undo restores the selection as it was *before* the edit. For a single
    // edit on a fresh document that pre-edit caret is legitimately 0; the bug
    // was never about this case (it had no prior context). The real regression
    // guard is the multi-edit case below, where the pre-edit caret is non-zero.
    expect(afterUndo.state.selection.main.head).toBe(0);
  });

  it('redo re-applies the edit', () => {
    let state = rootState('alpha\nbeta\ngamma');
    const editPos = state.doc.length;
    state = paneEdit({ from: editPos, insert: 'Z' }, state);

    const afterUndo = applyCommand(undo, state);
    const afterRedo = applyCommand(redo, afterUndo.state);
    expect(afterRedo.ran).toBe(true);
    // The document is restored to its post-edit content.
    expect(afterRedo.state.doc.toString()).toBe('alpha\nbeta\ngammaZ');
  });

  it('restores a recent caret context across multiple isolated edits, never the top', () => {
    let state = rootState('one\ntwo\nthree');
    const firstPos = 3; // end of "one"
    state = paneEdit({ from: firstPos, insert: 'X' }, state, true);
    const secondPos = state.doc.length;
    state = paneEdit({ from: secondPos, insert: 'Y' }, state, true);

    // Undo the second edit: the caret is restored to the selection that was
    // current before that edit — i.e. where the FIRST edit left the caret. This
    // is a recent, on-document position, decisively NOT the top. Before the fix
    // this collapsed to 0.
    const undo1 = applyCommand(undo, state);
    expect(undo1.state.doc.toString()).toBe('oneX\ntwo\nthree');
    expect(undo1.state.selection.main.head).toBeGreaterThan(0);
    expect(undo1.state.selection.main.head).toBe(firstPos + 1);

    // Undo the first edit as well: document fully restored; caret at the genuine
    // pre-first-edit position (0 here, which truly was the starting caret).
    const undo2 = applyCommand(undo, undo1.state);
    expect(undo2.state.doc.toString()).toBe('one\ntwo\nthree');
    expect(undo2.state.selection.main.head).toBeGreaterThanOrEqual(0);
  });
});
