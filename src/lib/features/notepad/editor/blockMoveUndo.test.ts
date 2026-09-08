import { describe, expect, it } from 'vitest';
import { history, undo, redo } from '@codemirror/commands';
import {
  EditorState,
  Transaction,
  type TransactionSpec
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import {
  listBlocks,
  minimalDocChange,
  moveBlockTo,
  moveCurrentBlock
} from './blockTypes';

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

function blockView(doc: string, anchor: number) {
  let state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [history()]
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Transaction | TransactionSpec) {
      const transaction =
        spec instanceof Transaction ? spec : state.update(spec);
      state = transaction.state;
    },
    focus() {}
  } as unknown as EditorView;
  return { view, readState: () => state };
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
  it('undoes an actual keyboard-style block move without collapsing the caret', () => {
    const fixture = blockView('line1\nline2\nline3', 8);

    // Option+ArrowUp: line2 swaps above line1; caret follows to column on new top line.
    expect(moveCurrentBlock(fixture.view, -1)).toBe(true);
    expect(fixture.readState().doc.toString()).toBe(
      'line2\nline1\nline3'
    );
    expect(fixture.readState().selection.main.head).toBe(2);

    expect(undo(fixture.view)).toBe(true);
    expect(fixture.readState().doc.toString()).toBe(
      'line1\nline2\nline3'
    );
    // The whole point of the bug report: the caret must NOT collapse to 0.
    expect(fixture.readState().selection.main.head).toBeGreaterThan(0);
    // It maps back to where it was before the move.
    expect(fixture.readState().selection.main.head).toBe(8);

    expect(redo(fixture.view)).toBe(true);
    expect(fixture.readState().doc.toString()).toBe(
      'line2\nline1\nline3'
    );
    // CodeMirror maps the pre-move caret through the replayed targeted change.
    // It lands at the changed-region boundary rather than collapsing to 0.
    expect(fixture.readState().selection.main.head).toBe(11);
  });

  it('undoes an actual drag-style block move back to an earlier deep edit', () => {
    const fixture = blockView('line1\nline2\nline3', 8);
    // A normal edit deep in the document (caret ends at 18).
    fixture.view.dispatch({
      changes: { from: 17, insert: 'X' },
      selection: { anchor: 18 }
    });

    const blocks = listBlocks(fixture.readState());
    expect(blocks).toHaveLength(3);
    expect(
      moveBlockTo(fixture.view, blocks[1]!, blocks[0]!, true)
    ).toBe(true);
    expect(fixture.readState().doc.toString()).toBe(
      'line2\nline1\nline3X'
    );

    // Undo the swap: the document rolls back and the caret returns deep into the
    // document where the earlier edit left it — decisively not the top. Before
    // the fix this collapsed to 0.
    expect(undo(fixture.view)).toBe(true);
    expect(fixture.readState().doc.toString()).toBe(
      'line1\nline2\nline3X'
    );
    expect(fixture.readState().selection.main.head).toBeGreaterThan(0);
    expect(fixture.readState().selection.main.head).toBe(18);
  });
});
