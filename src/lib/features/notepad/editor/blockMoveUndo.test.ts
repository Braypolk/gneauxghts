import { createCommandView } from './commandTestSupport';
import { describe, expect, it } from 'vitest';
import { history, undo, redo } from '@codemirror/commands';
import {
  listBlocks,
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
  const { view } = createCommandView({ doc, selection: { anchor }, extensions: [history()] });
  return { view, readState: () => view.state };
}

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
