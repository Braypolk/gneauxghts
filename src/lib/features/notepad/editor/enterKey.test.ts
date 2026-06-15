import { describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { markdownEnter } from './editor';
import { createMarkdownLanguage } from '$lib/features/notepad/markdown/markdownLanguage';

// Regression for the reported bug: pressing Enter on a normal line with text
// inserted MORE THAN ONE newline.
//
// Root cause was a missing authoritative Enter command. The Markdown language
// (addKeymap: true) and an explicit markdownKeymap each bound Enter to
// `insertNewlineContinueMarkup`, which returns false on a plain line. With
// defaultKeymap's Enter filtered out, every keymap binding declined, so the
// keypress fell through to the browser's native contentEditable handler — which
// inserted its own line break on top of CodeMirror's, yielding multiple lines.
//
// `markdownEnter` now always handles Enter (continue markup on a list/blockquote,
// otherwise a single newline+indent) so it never falls through to native.
// These tests drive it through the real CodeMirror commands against a headless
// state, counting dispatches so a silent regression to multi-dispatch / native
// fallthrough is caught.

// markdownEnter's commands only touch `.state` and `.dispatch`, so a minimal
// shim stands in for the EditorView. We record every dispatch to assert exactly
// one transaction per Enter.
function runEnter(doc: string, head: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor: head },
    // The markdown language must be present for `insertNewlineContinueMarkup`
    // to recognise list/blockquote markup; without it every Enter falls back to
    // a plain newline.
    extensions: [createMarkdownLanguage()]
  });
  const dispatched: Transaction[] = [];
  const view = {
    state,
    dispatch: (tr: Transaction) => dispatched.push(tr)
  } as unknown as EditorView;

  const handled = markdownEnter(view);
  const result = dispatched.length === 1 ? dispatched[0].state.doc.toString() : doc;
  return { handled, dispatches: dispatched.length, doc: result };
}

describe('markdownEnter', () => {
  it('inserts exactly one newline at the end of a plain text line', () => {
    const { handled, dispatches, doc } = runEnter('hello', 5);
    expect(handled).toBe(true);
    expect(dispatches).toBe(1);
    expect(doc).toBe('hello\n');
  });

  it('inserts exactly one newline in the middle of a plain text line', () => {
    const { handled, dispatches, doc } = runEnter('hello', 2);
    expect(handled).toBe(true);
    expect(dispatches).toBe(1);
    expect(doc).toBe('he\nllo');
  });

  it('preserves leading indentation with a single newline', () => {
    // caret at end of "  indented"
    const { handled, dispatches, doc } = runEnter('  indented', 10);
    expect(handled).toBe(true);
    expect(dispatches).toBe(1);
    expect(doc).toBe('  indented\n  ');
  });

  it('continues a non-empty bullet list item with a fresh marker (one dispatch)', () => {
    const { handled, dispatches, doc } = runEnter('- a', 3);
    expect(handled).toBe(true);
    expect(dispatches).toBe(1);
    expect(doc).toBe('- a\n- ');
  });

  it('continues a non-empty ordered list item (one dispatch)', () => {
    const { handled, dispatches, doc } = runEnter('1. a', 4);
    expect(handled).toBe(true);
    expect(dispatches).toBe(1);
    expect(doc).toBe('1. a\n2. ');
  });

  it('never declines — Enter is always handled so it cannot fall through to native', () => {
    // The crux of the fix: on a plain line the command must still return true
    // (handled) so the browser never inserts its own extra line break.
    expect(runEnter('plain', 5).handled).toBe(true);
    expect(runEnter('', 0).handled).toBe(true);
  });
});
