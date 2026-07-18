import { Compartment, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import { insertEditorMarkdown } from './editorCapabilities';
import type { EditorController } from './editor';

function createController(markdown: string, anchor: number, head = anchor) {
  let state = EditorState.create({ doc: markdown, selection: { anchor, head } });
  const transactions: Transaction[] = [];
  const focus = vi.fn();
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: Transaction | TransactionSpec) => {
      const transaction = spec instanceof Transaction ? spec : state.update(spec);
      transactions.push(transaction);
      state = transaction.state;
    },
    focus
  } as unknown as EditorView;
  const controller = {
    view,
    sharedResources: null,
    paneKey: Symbol('test-pane'),
    onMarkdownChange: () => {},
    proposalReviewCompartment: new Compartment()
  } satisfies EditorController;
  return { controller, transactions, focus, readState: () => state };
}

describe('insertEditorMarkdown', () => {
  it('replaces the selection in one undoable transaction and places the cursor after it', () => {
    const harness = createController('hello world', 0, 5);

    expect(insertEditorMarkdown(harness.controller, 'goodbye', { focus: true })).toEqual({
      from: 0,
      to: 5,
      cursor: 7
    });

    expect(harness.transactions).toHaveLength(1);
    expect(harness.readState().doc.toString()).toBe('goodbye world');
    expect(harness.readState().selection.main.anchor).toBe(7);
    expect(harness.transactions[0].annotation(Transaction.userEvent)).toBe('input.chat-insert');
    expect(harness.focus).toHaveBeenCalledOnce();
  });

  it.each([
    ['cursor', 'abDEFc', 5],
    ['end', 'abcDEF', 6]
  ] as const)('inserts at the %s without replacing the selection', (target, expected, cursor) => {
    const harness = createController('abc', 0, 2);

    const result = insertEditorMarkdown(harness.controller, 'DEF', {
      target,
      scrollIntoView: false
    });

    expect(result).toMatchObject({ cursor });
    expect(harness.readState().doc.toString()).toBe(expected);
    expect(harness.transactions).toHaveLength(1);
  });

  it('does nothing when the editor is unavailable', () => {
    expect(insertEditorMarkdown(null, 'text')).toBeNull();
  });
});
