import { describe, expect, it } from 'vitest';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { applyInlineFormat, getActiveInlineFormats, type InlineFormatId } from './inlineFormatting';
import { createMarkdownLanguage } from '$lib/features/notepad/markdown/markdownLanguage';

function runFormat(doc: string, from: number, to: number, id: InlineFormatId) {
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

  const handled = applyInlineFormat(view, id);
  const result =
    handled && dispatched.length === 1 ? dispatched[0].state.doc.toString() : doc;
  const selection =
    handled && dispatched.length === 1 ? dispatched[0].state.selection.main : state.selection.main;

  return { handled, doc: result, from: selection.from, to: selection.to };
}

function activeFormats(doc: string, from: number, to: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [createMarkdownLanguage()]
  });
  return getActiveInlineFormats(state, from, to);
}

describe('applyInlineFormat toggle', () => {
  it('wraps plain selected text in bold markers', () => {
    const { handled, doc } = runFormat('hello world', 0, 5, 'bold');
    expect(handled).toBe(true);
    expect(doc).toBe('**hello** world');
  });

  it('unwraps bold when the selection includes markers', () => {
    const { handled, doc } = runFormat('**hello**', 0, 9, 'bold');
    expect(handled).toBe(true);
    expect(doc).toBe('hello');
  });

  it('unwraps bold when only the inner text is selected', () => {
    const { handled, doc } = runFormat('**hello**', 2, 7, 'bold');
    expect(handled).toBe(true);
    expect(doc).toBe('hello');
  });

  it('unwraps italic when only the inner text is selected', () => {
    const { handled, doc } = runFormat('*hello*', 1, 6, 'italic');
    expect(handled).toBe(true);
    expect(doc).toBe('hello');
  });

  it('unwraps strikethrough when only the inner text is selected', () => {
    const { handled, doc } = runFormat('~~gone~~', 2, 6, 'strikethrough');
    expect(handled).toBe(true);
    expect(doc).toBe('gone');
  });

  it('unwraps highlight when only the inner text is selected', () => {
    const { handled, doc } = runFormat('==bright==', 2, 8, 'highlight');
    expect(handled).toBe(true);
    expect(doc).toBe('bright');
  });

  it('unwraps Obsidian comments when only the inner text is selected', () => {
    const { handled, doc } = runFormat('%%hidden note%%', 2, 13, 'comment');
    expect(handled).toBe(true);
    expect(doc).toBe('hidden note');
  });

  it('unwraps inline code when only the inner text is selected', () => {
    const { handled, doc } = runFormat('`code`', 1, 5, 'code');
    expect(handled).toBe(true);
    expect(doc).toBe('code');
  });

  it('unwraps markdown links when only the label is selected', () => {
    const { handled, doc } = runFormat('[label](https://example.com)', 1, 6, 'link');
    expect(handled).toBe(true);
    expect(doc).toBe('label');
  });

  it('unwraps wikilinks when only the title is selected', () => {
    const { handled, doc } = runFormat('[[Note Title]]', 2, 12, 'wikilink');
    expect(handled).toBe(true);
    expect(doc).toBe('Note Title');
  });

  it('does not unwrap bold when toggling italic inside bold text', () => {
    const { handled, doc } = runFormat('**bold**', 2, 6, 'italic');
    expect(handled).toBe(true);
    expect(doc).toBe('**_bold_**');
  });

  it('preserves the selected range after unwrapping', () => {
    const { handled, doc, from, to } = runFormat('**hello**', 2, 5, 'bold');
    expect(handled).toBe(true);
    expect(doc).toBe('hello');
    expect(from).toBe(0);
    expect(to).toBe(3);
  });
});

describe('getActiveInlineFormats', () => {
  it('detects active bold when only inner text is selected', () => {
    expect(activeFormats('**hello**', 2, 7)).toContain('bold');
  });

  it('detects active italic without marking bold as active', () => {
    expect(activeFormats('*hello*', 1, 6)).toEqual(['italic']);
  });

  it('detects multiple active formats in nested text', () => {
    expect(activeFormats('**bold _and italic_**', 8, 18)).toContain('italic');
    expect(activeFormats('**bold _and italic_**', 2, 6)).toContain('bold');
  });

  it('returns no active formats for plain text', () => {
    expect(activeFormats('plain text', 0, 5)).toEqual([]);
  });
});
