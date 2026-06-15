import { describe, expect, it } from 'vitest';
import { history, undo, redo } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';

import { minimalDocChange } from './blockTypes';

// Regression coverage for the reported bug: moving a line with Option+Arrow
// (a block reorder) followed by Cmd+Z sent the caret and viewport to the top.
//
// Root cause: block operations (moveCurrentBlock / moveBlockTo /
// deleteCurrentBlock) rewrote the document with a *whole-document* replacement
// (`changes: { from: 0, to: doc.length, insert }`). CodeMirror restores the
// caret on undo by mapping the stored selection through the change's INVERSE,
// and the inverse of a full-document replacement collapses every position to 0.
// So undo always jumped to the top, regardless of the forwarded selection.
//
// The fix: `replaceWholeDoc` now emits a minimal change (shared prefix/suffix
// trimmed via `minimalDocChange`). Untouched regions map to themselves, so undo
// and redo keep the caret near the edit — VS Code-like behavior. These tests
// run against a real CodeMirror history, no DOM.

function rootState(doc: string) {
  return EditorState.create({ doc, extensions: [history()] });
}

function applyCommand(
  command: (cfg: { state: EditorState; dispatch: (t: Transaction) => void }) => boolean,
  state: EditorState
) {
  let next: Transaction | null = null;
  const ran = command({ state, dispatch: (t) => (next = t) });
  return { ran, state: next ? (next as Transaction).state : state };
}

describe('minimalDocChange', () => {
  it('trims shared prefix and suffix to a targeted middle change', () => {
    // "line1\nline2\nline3" -> "line2\nline1\nline3" (swap first two lines)
    const change = minimalDocChange('line1\nline2\nline3', 'line2\nline1\nline3');
    // Only the differing middle is rewritten; the shared "line" prefix and the
    // shared "\nline3" suffix are left untouched (NOT a from:0/to:len replace).
    expect(change.from).toBeGreaterThan(0);
    expect(change.to).toBeLessThan('line1\nline2\nline3'.length);
    // Sanity: applying the change reproduces the target text.
    const before = 'line1\nline2\nline3';
    const after = before.slice(0, change.from) + change.insert + before.slice(change.to);
    expect(after).toBe('line2\nline1\nline3');
  });

  it('reports a no-op as an empty change at the divergence point', () => {
    const change = minimalDocChange('same', 'same');
    expect(change).toEqual({ from: 4, to: 4, insert: '' });
  });

  it('handles a pure deletion (block delete) as a targeted removal', () => {
    // delete the middle line: "a\nb\nc" -> "a\nc"
    const change = minimalDocChange('a\nb\nc', 'a\nc');
    const before = 'a\nb\nc';
    const after = before.slice(0, change.from) + change.insert + before.slice(change.to);
    expect(after).toBe('a\nc');
    expect(change.from).toBeLessThan(change.to); // it removes text
  });
});

describe('line move + undo/redo caret restoration', () => {
  // A block move applies the minimal change with the new caret selection, the
  // exact spec replaceWholeDoc now produces.
  function moveViaMinimalChange(state: EditorState, newText: string, anchor: number) {
    return state.update({
      changes: minimalDocChange(state.doc.toString(), newText),
      selection: { anchor }
    }).state;
  }

  it('undo after a line swap restores the caret near the edit, not the top', () => {
    let state = rootState('line1\nline2\nline3');
    // Caret sits on line2 before the move.
    state = state.update({ selection: { anchor: 8 } }).state;

    // Option+ArrowUp: line2 swaps above line1; caret follows to column on new top line.
    state = moveViaMinimalChange(state, 'line2\nline1\nline3', 2);
    expect(state.doc.toString()).toBe('line2\nline1\nline3');

    const afterUndo = applyCommand(undo, state);
    expect(afterUndo.ran).toBe(true);
    expect(afterUndo.state.doc.toString()).toBe('line1\nline2\nline3');
    // The whole point of the bug report: the caret must NOT collapse to 0.
    expect(afterUndo.state.selection.main.head).toBeGreaterThan(0);
    // It maps back to where it was before the move.
    expect(afterUndo.state.selection.main.head).toBe(8);

    const afterRedo = applyCommand(redo, afterUndo.state);
    expect(afterRedo.state.doc.toString()).toBe('line2\nline1\nline3');
    expect(afterRedo.state.selection.main.head).toBeGreaterThan(0);
  });

  it('undo of a swap that follows an earlier deep edit keeps the caret deep', () => {
    let state = rootState('line1\nline2\nline3');
    // A normal edit deep in the document (caret ends at 18).
    state = state.update({ changes: { from: 17, insert: 'X' }, selection: { anchor: 18 } }).state;

    // Then a line swap (whole-doc-looking rewrite, now a minimal change).
    state = moveViaMinimalChange(state, 'line2\nline1\nline3X', 2);

    // Undo the swap: the document rolls back and the caret returns deep into the
    // document where the earlier edit left it — decisively not the top. Before
    // the fix this collapsed to 0.
    const afterUndo = applyCommand(undo, state);
    expect(afterUndo.state.doc.toString()).toBe('line1\nline2\nline3X');
    expect(afterUndo.state.selection.main.head).toBeGreaterThan(0);
    expect(afterUndo.state.selection.main.head).toBe(18);
  });
});
