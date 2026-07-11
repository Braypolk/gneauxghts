import { describe, expect, it } from 'vitest';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { surroundRange } from './selectionSurround';
import { createMarkdownLanguage } from '$lib/features/notepad/markdown/markdownLanguage';

function runSurround(doc: string, from: number, to: number, trigger: string) {
  let state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [createMarkdownLanguage()]
  });
  const dispatched: Transaction[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: Transaction | TransactionSpec) => {
      const transaction = spec instanceof Transaction ? spec : state.update(spec);
      state = transaction.state;
      dispatched.push(transaction);
    },
    focus: () => {}
  } as unknown as EditorView;

  const handled = surroundRange(view, from, to, trigger);
  const result =
    handled && dispatched.length === 1 ? dispatched[0].state.doc.toString() : doc;
  const selection =
    handled && dispatched.length === 1 ? dispatched[0].state.selection.main : state.selection.main;

  return { handled, doc: result, from: selection.from, to: selection.to };
}

describe('surroundRange', () => {
  it('wraps selected text with asterisks instead of replacing it', () => {
    const { handled, doc, from, to } = runSurround('hello world', 0, 5, '*');
    expect(handled).toBe(true);
    expect(doc).toBe('*hello* world');
    expect(from).toBe(1);
    expect(to).toBe(6);
  });

  it('uses the expected delimiters for the remaining surround triggers', () => {
    const cases = [
      ['hello', '_', '_hello_'],
      ['hello', '(', '(hello)'],
      ['code', '`', '`code`'],
      ['gone', '~', '~~gone~~'],
      ['bright', '=', '==bright==']
    ] as const;

    for (const [source, trigger, expected] of cases) {
      const result = runSurround(source, 0, source.length, trigger);
      expect(result, trigger).toMatchObject({ handled: true, doc: expected });
    }
  });

  it('wraps selected text as a markdown link and places the cursor in the url', () => {
    const { handled, doc, from, to } = runSurround('label', 0, 5, '[');
    expect(handled).toBe(true);
    expect(doc).toBe('[label]()');
    expect(from).toBe(8);
    expect(to).toBe(8);
  });

  it('does nothing when the selection is empty', () => {
    const { handled, doc } = runSurround('hello', 2, 2, '*');
    expect(handled).toBe(false);
    expect(doc).toBe('hello');
  });

  it('does nothing for unsupported characters', () => {
    const { handled, doc } = runSurround('hello', 0, 5, 'x');
    expect(handled).toBe(false);
    expect(doc).toBe('hello');
  });

  it('does not wrap inside fenced code blocks', () => {
    const fencedDoc = '```\nhello\n```';
    const { handled, doc } = runSurround(fencedDoc, 4, 9, '*');
    expect(handled).toBe(false);
    expect(doc).toBe(fencedDoc);
  });
});
