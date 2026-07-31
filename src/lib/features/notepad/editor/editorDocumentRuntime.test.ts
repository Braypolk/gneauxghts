import {
  Compartment,
  EditorState,
  Transaction,
  type TransactionSpec
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { replaceEditorDocument } from './editorViewController';
import type { EditorController } from './types';

function pane(
  runtime: EditorDocumentRuntime,
  markdown: string,
  anchor: number,
  onMarkdownChange = vi.fn()
) {
  let state = EditorState.create({
    doc: markdown,
    selection: { anchor }
  });
  const scrollDOM = {
    scrollTop: 0,
    scrollLeft: 0
  };
  const view = {
    get state() {
      return state;
    },
    update(transactions: readonly Transaction[]) {
      for (const transaction of transactions) state = transaction.state;
    },
    dispatch(spec: Transaction | TransactionSpec) {
      const transaction =
        spec instanceof Transaction ? spec : state.update(spec);
      state = transaction.state;
    },
    scrollDOM
  } as unknown as EditorView;
  const controller: EditorController = {
    view,
    runtime,
    sharedResources: null,
    paneKey: Symbol('pane'),
    onMarkdownChange,
    proposalReviewCompartment: new Compartment()
  };
  runtime.attachController(controller);
  return {
    controller,
    onMarkdownChange,
    readState: () => state,
    setViewport: (scrollTop: number, scrollLeft = 0) => {
      scrollDOM.scrollTop = scrollTop;
      scrollDOM.scrollLeft = scrollLeft;
    },
    readViewport: () => ({ ...scrollDOM })
  };
}

describe('EditorDocumentRuntime', () => {
  it('broadcasts one pane edit while preserving independent pane selections', () => {
    const runtime = new EditorDocumentRuntime('abcd');
    const first = pane(runtime, 'abcd', 1);
    const second = pane(runtime, 'abcd', 4);
    second.setViewport(240, 12);
    const transaction = first.readState().update({
      changes: { from: 1, insert: 'X' },
      selection: { anchor: 2 }
    });

    runtime.dispatchFromPane(first.controller, [transaction]);

    expect(runtime.markdown).toBe('aXbcd');
    expect(first.readState().selection.main.head).toBe(2);
    expect(second.readState().selection.main.head).toBe(5);
    expect(second.readViewport()).toEqual({
      scrollTop: 240,
      scrollLeft: 12
    });
    expect(first.onMarkdownChange).toHaveBeenCalledTimes(1);
    expect(second.onMarkdownChange).not.toHaveBeenCalled();
  });

  it('shares undo history and restores selection in the requesting pane', () => {
    const runtime = new EditorDocumentRuntime('abcd');
    const first = pane(runtime, 'abcd', 1);
    const second = pane(runtime, 'abcd', 4);
    runtime.dispatchFromPane(first.controller, [
      first.readState().update({
        changes: { from: 1, insert: 'X' },
        selection: { anchor: 2 }
      })
    ]);

    expect(runtime.undo(second.controller.paneKey)).toBe(true);
    expect(first.readState().doc.toString()).toBe('abcd');
    expect(second.readState().doc.toString()).toBe('abcd');
    expect(second.readState().selection.main.anchor).toBe(1);
    expect(second.onMarkdownChange).toHaveBeenCalledOnce();
  });

  it('replaces every attached pane with clamped selections and one callback', () => {
    const runtime = new EditorDocumentRuntime('long document');
    const first = pane(runtime, 'long document', 2);
    const second = pane(runtime, 'long document', 12);
    first.setViewport(80);
    second.setViewport(320);

    const changed = runtime.applyExternalSnapshot(
      {
        markdown: 'tiny',
        selection: { anchor: 3, head: 3 },
        revision: 1
      },
      first.controller
    );

    expect(changed).toBe(true);
    expect(first.readState().doc.toString()).toBe('tiny');
    expect(second.readState().doc.toString()).toBe('tiny');
    expect(first.readState().selection.main.head).toBe(3);
    expect(second.readState().selection.main.head).toBe(4);
    expect(first.readViewport().scrollTop).toBe(80);
    expect(second.readViewport().scrollTop).toBe(320);
    expect(first.onMarkdownChange).toHaveBeenCalledTimes(1);
    expect(second.onMarkdownChange).not.toHaveBeenCalled();
  });

  it('keeps different note runtimes isolated', () => {
    const leftRuntime = new EditorDocumentRuntime('left');
    const rightRuntime = new EditorDocumentRuntime('right');
    const left = pane(leftRuntime, 'left', 4);
    const right = pane(rightRuntime, 'right', 5);

    leftRuntime.dispatchFromPane(left.controller, [
      left.readState().update({ changes: { from: 4, insert: '!' } })
    ]);

    expect(leftRuntime.markdown).toBe('left!');
    expect(rightRuntime.markdown).toBe('right');
    expect(right.readState().doc.toString()).toBe('right');
  });

  it('applies a requested selection when replacement markdown is unchanged', () => {
    const runtime = new EditorDocumentRuntime('same');
    const fixture = pane(runtime, 'same', 0);

    expect(
      replaceEditorDocument(fixture.controller, 'same', {
        anchor: 4,
        head: 4
      })
    ).toBe(true);
    expect(fixture.readState().selection.main.anchor).toBe(4);
    expect(fixture.onMarkdownChange).not.toHaveBeenCalled();
  });
});
