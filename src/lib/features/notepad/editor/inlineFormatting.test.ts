import { createCommandView } from './commandTestSupport';
import { describe, expect, it } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

import { applyInlineFormat, getActiveInlineFormats, type InlineFormatId } from './inlineFormatting';
import { createMarkdownLanguage } from '#lib/features/notepad/markdown/markdownLanguage.js';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { createRuntimePane } from './testSupport';

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

describe('caret formatting', () => {
  const wraps = [
    ['bold', '**'],
    ['italic', '*'],
    ['strikethrough', '~~'],
    ['highlight', '=='],
    ['comment', '%%'],
    ['code', '`']
  ] as const;

  it.each(wraps)('formats the current word as %s while retaining the caret offset', (id, marker) => {
    expect(runFormat('hello world', 2, 2, id)).toMatchObject({
      handled: true,
      doc: `${marker}hello${marker} world`,
      anchor: 2 + marker.length,
      head: 2 + marker.length
    });
  });

  it.each(wraps)('removes enclosing %s without selecting its text', (id, marker) => {
    expect(runFormat(`${marker}hello${marker}`, marker.length + 2, marker.length + 2, id))
      .toMatchObject({ handled: true, doc: 'hello', anchor: 2, head: 2 });
  });

  it.each(wraps)('inserts and toggles an empty %s pair', (id, marker) => {
    const { view } = createCommandView({ extensions: [createMarkdownLanguage()] });
    expect(applyInlineFormat(view, id)).toBe(true);
    expect(view.state.doc.toString()).toBe(marker + marker);
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(marker.length);
    expect(applyInlineFormat(view, id)).toBe(true);
    expect(view.state.doc.toString()).toBe('');
    expect(view.state.selection.main.head).toBe(0);
  });

  it('uses underscores for italic inside bold and toggles them independently', () => {
    const { view } = createCommandView({
      doc: '**bold**',
      selection: { anchor: 4 },
      extensions: [createMarkdownLanguage()]
    });
    expect(applyInlineFormat(view, 'italic')).toBe(true);
    expect(view.state.doc.toString()).toBe('**_bold_**');
    expect(view.state.selection.main.head).toBe(5);
    expect(applyInlineFormat(view, 'italic')).toBe(true);
    expect(view.state.doc.toString()).toBe('**bold**');
    expect(view.state.selection.main.head).toBe(4);
  });

  it('can combine and independently toggle bold and italic before typing', () => {
    const { view } = createCommandView({ extensions: [createMarkdownLanguage()] });
    expect(applyInlineFormat(view, 'bold')).toBe(true);
    expect(applyInlineFormat(view, 'italic')).toBe(true);
    expect(view.state.doc.toString()).toBe('**__**');
    expect(view.state.selection.main.head).toBe(3);
    expect(applyInlineFormat(view, 'bold')).toBe(true);
    expect(view.state.doc.toString()).toBe('__');
    expect(view.state.selection.main.head).toBe(1);
    expect(applyInlineFormat(view, 'italic')).toBe(true);
    expect(view.state.doc.toString()).toBe('');
  });

  it.each([
    ['bold', 'italic', '**__**'],
    ['italic', 'bold', '*____*']
  ] as const)('can toggle %s then %s and remove the pairs in reverse order', (outer, inner, combined) => {
    const { view } = createCommandView({ extensions: [createMarkdownLanguage()] });
    expect(applyInlineFormat(view, outer)).toBe(true);
    const outerPair = view.state.doc.toString();
    expect(applyInlineFormat(view, inner)).toBe(true);
    expect(view.state.doc.toString()).toBe(combined);
    expect(applyInlineFormat(view, inner)).toBe(true);
    expect(view.state.doc.toString()).toBe(outerPair);
    expect(applyInlineFormat(view, outer)).toBe(true);
    expect(view.state.doc.toString()).toBe('');
    expect(view.state.selection.main.head).toBe(0);
  });

  it.each([
    ['*word*', 3, 'bold', '*__word__*', 5],
    ['_word_', 3, 'bold', '_**word**_', 5],
    ['**word**', 4, 'italic', '**_word_**', 5],
    ['__word__', 4, 'italic', '__*word*__', 5],
    ['__', 1, 'bold', '_****_', 3],
    ['____', 2, 'italic', '__**__', 3]
  ] as const)('uses compatible markers inside %s and preserves its outer formatting', (doc, caret, id, combined, combinedCaret) => {
    const { view } = createCommandView({ doc, selection: { anchor: caret }, extensions: [createMarkdownLanguage()] });
    expect(applyInlineFormat(view, id)).toBe(true);
    expect(view.state.doc.toString()).toBe(combined);
    expect(view.state.selection.main.head).toBe(combinedCaret);
    expect(applyInlineFormat(view, id)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.head).toBe(caret);
  });

  it('inserts markers at whitespace, punctuation and word edges', () => {
    for (const [source, position, expected] of [
      ['hello world', 0, '****hello world'],
      ['hello world', 5, 'hello**** world'],
      ['hello world', 6, 'hello ****world'],
      ['hello world', 11, 'hello world****'],
      ['hello, world', 6, 'hello,**** world'],
      ['one\n\ntwo', 4, 'one\n****\ntwo']
    ] as const) {
      expect(runFormat(source, position, position, 'bold')).toMatchObject({
        handled: true,
        doc: expected,
        anchor: position + 2,
        head: position + 2
      });
    }
  });

  it('uses editor word boundaries for Unicode words without consuming punctuation', () => {
    expect(runFormat('(café), tea', 3, 3, 'bold')).toMatchObject({
      doc: '(**café**), tea', anchor: 5, head: 5
    });
    expect(runFormat('你好，世界', 1, 1, 'italic')).toMatchObject({
      doc: '*你好*，世界', anchor: 2, head: 2
    });
  });

  it('does not mistake a bold marker or escaped stars for an empty italic pair', () => {
    for (const [source, position] of [['**bold**', 1], ['\\**', 2], ['****', 1]] as const) {
      const result = runFormat(source, position, position, 'italic');
      expect(result.doc.length).toBe(source.length + 2);
    }
  });

  it('keeps a caret format command in one undo step and restores the original caret', () => {
    for (const [doc, position, expected] of [
      ['hello', 2, '**hello**'],
      ['', 0, '****'],
      ['**hello**', 4, 'hello'],
      ['****', 2, '']
    ] as const) {
      const { view, transactions } = createCommandView({
        doc, selection: { anchor: position }, extensions: [history(), createMarkdownLanguage()]
      });
      expect(applyInlineFormat(view, 'bold')).toBe(true);
      expect(transactions).toHaveLength(1);
      expect(view.state.doc.toString()).toBe(expected);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
      expect(view.state.selection.main.head).toBe(position);
    }
  });

  it('shares caret formatting and Undo across panes without changing a sibling caret', () => {
    const runtime = new EditorDocumentRuntime('hello');
    try {
      const first = createRuntimePane(runtime, 'hello', 2, undefined, [createMarkdownLanguage()]);
      const sibling = createRuntimePane(runtime, 'hello', 0, undefined, [createMarkdownLanguage()]);
      expect(applyInlineFormat(first.view, 'bold')).toBe(true);
      expect(runtime.markdown).toBe('**hello**');
      expect(sibling.view.state.doc.toString()).toBe('**hello**');
      expect(sibling.view.state.selection.main.head).toBe(0);
      expect(runtime.undo(sibling.controller.paneKey)).toBe(true);
      expect(runtime.markdown).toBe('hello');
      expect(first.view.state.doc.toString()).toBe('hello');
      expect(sibling.view.state.selection.main.head).toBe(2);
      expect(runtime.undo(sibling.controller.paneKey)).toBe(false);
    } finally {
      runtime.destroy();
    }
  });

  it('undoes caret formatting separately from preceding typing', () => {
    const { view } = createCommandView({
      doc: 'helo', selection: { anchor: 2 }, extensions: [history(), createMarkdownLanguage()]
    });
    view.dispatch({
      changes: { from: 2, insert: 'l' }, selection: { anchor: 3 },
      annotations: Transaction.userEvent.of('input.type')
    });
    expect(applyInlineFormat(view, 'bold')).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('hello');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('helo');
  });

  it('refuses changes to a read-only editor or during composition', () => {
    for (const id of ['bold', 'italic', 'link', 'wikilink'] as const) {
      for (const selection of [{ anchor: 2 }, { anchor: 0, head: 5 }]) {
        for (const blockedBy of ['readOnly', 'composing', 'compositionStarted']) {
          const { view, transactions } = createCommandView({
            doc: 'hello', selection,
            extensions: [createMarkdownLanguage(), EditorState.readOnly.of(blockedBy === 'readOnly')]
          });
          if (blockedBy === 'composing') Object.assign(view, { composing: true });
          if (blockedBy === 'compositionStarted') Object.assign(view, { compositionStarted: true });
          expect(applyInlineFormat(view, id)).toBe(false);
          expect(transactions).toHaveLength(0);
        }
      }
    }
  });
});

describe('inline code delimiters', () => {
  it.each(['bold', 'code'] as const)('undoes selected %s commands separately from paste and each other', (id) => {
    const runtime = new EditorDocumentRuntime('');
    try {
      const first = createRuntimePane(runtime, '', 0, undefined, [createMarkdownLanguage()]);
      const sibling = createRuntimePane(runtime, '', 0, undefined, [createMarkdownLanguage()]);
      first.view.dispatch({ changes: { from: 0, insert: 'word' }, selection: { anchor: 0, head: 4 }, userEvent: 'input.paste' });
      expect(applyInlineFormat(first.view, id)).toBe(true);
      const formatted = runtime.markdown;
      expect(applyInlineFormat(first.view, id)).toBe(true);
      expect(runtime.markdown).toBe('word');
      expect(runtime.undo(sibling.controller.paneKey)).toBe(true);
      expect(runtime.markdown).toBe(formatted);
      expect(runtime.undo(sibling.controller.paneKey)).toBe(true);
      expect(runtime.markdown).toBe('word');
      expect(runtime.undo(sibling.controller.paneKey)).toBe(true);
      expect(runtime.markdown).toBe('');
    } finally { runtime.destroy(); }
  });

  it.each([
    ['a `tick` here', '``a `tick` here``', 2],
    ['a ``tick`` here', '```a ``tick`` here```', 3],
    ['`tick` plus', '`` `tick` plus ``', 3],
    ['plus `tick`', '`` plus `tick` ``', 3],
    [' padded ', '`  padded  `', 2],
    ['   ', '`   `', 1]
  ] as const)('wraps %s as one valid code span and toggles its exact text back', (text, wrapped, start) => {
    const { view } = createCommandView({
      doc: text, selection: { anchor: 0, head: text.length }, extensions: [createMarkdownLanguage(), history()]
    });
    expect(applyInlineFormat(view, 'code')).toBe(true);
    expect(view.state.doc.toString()).toBe(wrapped);
    expect(view.state.selection.main.from).toBe(start);
    expect(view.state.selection.main.to).toBe(start + text.length);
    const code = syntaxTree(view.state).topNode.firstChild?.firstChild;
    expect(code?.name).toBe('InlineCode');
    expect(code?.from).toBe(0);
    expect(code?.to).toBe(wrapped.length);
    expect(code?.nextSibling).toBeNull();
    expect(applyInlineFormat(view, 'code')).toBe(true);
    expect(view.state.doc.toString()).toBe(text);
  });

  it('removes all code delimiters around an existing multi-backtick span and maps its caret', () => {
    expect(runFormat('``a `tick` here``', 7, 7, 'code')).toMatchObject({
      doc: 'a `tick` here', anchor: 5, head: 5
    });
    expect(runFormat('`` `tick` plus ``', 7, 7, 'code')).toMatchObject({
      doc: '`tick` plus', anchor: 4, head: 4
    });
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
