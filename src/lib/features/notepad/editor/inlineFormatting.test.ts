import { createCommandView } from './commandTestSupport';
import { describe, expect, it } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';

import { applyInlineFormat, getActiveInlineFormats, type InlineFormatId } from './inlineFormatting';
import { createMarkdownLanguage } from '#lib/features/notepad/markdown/markdownLanguage.js';

function runFormat(doc: string, from: number, to: number, id: InlineFormatId) {
  const { view, transactions: dispatched } = createCommandView({
    doc,
    selection: { anchor: from, head: to },
    extensions: [createMarkdownLanguage()]
  });

  const handled = applyInlineFormat(view, id);
  const result =
    handled && dispatched.length === 1 ? dispatched[0].state.doc.toString() : doc;
  const selection =
    handled && dispatched.length === 1 ? dispatched[0].state.selection.main : view.state.selection.main;

  return {
    handled,
    doc: result,
    from: selection.from,
    to: selection.to,
    anchor: selection.anchor,
    head: selection.head
  };
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

  it('unwraps bold when the selection includes markers', () => {
    const { handled, doc } = runFormat('**hello**', 0, 9, 'bold');
    expect(handled).toBe(true);
    expect(doc).toBe('hello');
  });

  it('unwraps link formats when their inner text is selected', () => {
    const cases: [string, number, number, InlineFormatId, string][] = [
      ['[label](https://example.com)', 1, 6, 'link', 'label'],
      ['[[Note Title]]', 2, 12, 'wikilink', 'Note Title']
    ];

    for (const [source, from, to, format, expected] of cases) {
      const result = runFormat(source, from, to, format);
      expect(result, format).toMatchObject({ handled: true, doc: expected });
    }
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

describe('link formatting command', () => {
  it('wraps selected text and places the caret in the URL', () => {
    expect(runFormat('hello world', 0, 5, 'link')).toMatchObject({
      handled: true,
      doc: '[hello]() world',
      anchor: 8,
      head: 8
    });
  });

  it('supports reverse and multiline selections', () => {
    expect(runFormat('one\ntwo', 7, 0, 'link')).toMatchObject({
      handled: true,
      doc: '[one\ntwo]()',
      anchor: 10,
      head: 10
    });
  });

  it('unwraps an enclosing Markdown link', () => {
    expect(
      runFormat('[label](https://example.com)', 2, 5, 'link')
    ).toMatchObject({ handled: true, doc: 'label', from: 1, to: 4 });
  });

  it('inserts an empty link and places the caret in the label without a selection', () => {
    for (const [source, position, expected] of [
      ['', 0, '[]()'],
      ['hello', 0, '[]()hello'],
      ['hello', 2, 'he[]()llo'],
      ['hello', 5, 'hello[]()']
    ] as const) {
      expect(runFormat(source, position, position, 'link')).toMatchObject({
        handled: true,
        doc: expected,
        anchor: position + 1,
        head: position + 1
      });
    }
  });

  it('is a single undoable editor transaction', () => {
    const { view } = createCommandView({ doc: 'hello', selection: { anchor: 0, head: 5 }, extensions: [history(), createMarkdownLanguage()] });

    expect(applyInlineFormat(view, 'link')).toBe(true);
    expect(view.state.doc.toString()).toBe('[hello]()');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('hello');
  });

  it('restores the original caret when undoing an empty link insertion', () => {
    const { view, transactions } = createCommandView({
      doc: 'hello',
      selection: { anchor: 2 },
      extensions: [history(), createMarkdownLanguage()]
    });

    expect(applyInlineFormat(view, 'link')).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(view.state.doc.toString()).toBe('he[]()llo');
    expect(view.state.selection.main.head).toBe(3);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('hello');
    expect(view.state.selection.main.head).toBe(2);
  });
});

describe('getActiveInlineFormats', () => {

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
