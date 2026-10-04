import { createCommandView } from './commandTestSupport';
import { history, undo } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { createIndentExtensions } from './indentConfig';
import {
  indentEditorSelection,
  outdentEditorSelection,
  planListIndentation
} from './structuralIndentation';
import { createMarkdownLanguage } from '../markdown/markdownLanguage';

function stateWithSelection(
  doc: string,
  anchor: number,
  head = anchor,
  extraExtensions: Extension[] = []
) {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [createMarkdownLanguage(), ...createIndentExtensions(), ...extraExtensions]
  });
}

function selectText(doc: string, startText: string, endText = startText) {
  const anchor = doc.indexOf(startText);
  const endStart = doc.indexOf(endText, anchor);
  if (anchor < 0 || endStart < 0) {
    throw new Error('selection text not found');
  }
  return { anchor, head: endStart + endText.length };
}

function applyPlan(state: EditorState, direction: 'indent' | 'outdent') {
  const plan = planListIndentation(state, direction);
  if (plan.kind !== 'changes') {
    return { plan, state };
  }
  return { plan, state: state.update({ changes: plan.changes }).state };
}

function mutableView(initialState: EditorState) {
  const { view } = createCommandView(initialState);
  return { view, get state() { return view.state; } };
}

describe('structural list indentation planner', () => {
  it.each([
    ['task', '- [ ] parent\n- [ ] child', '- [ ] parent\n  - [ ] child'],
    ['mixed bullet marker', '- parent\n* child', '- parent\n  * child'],
    ['multi-digit ordered', '10. parent\n11. child', '10. parent\n    11. child']
  ])('nests a %s item beneath its preceding sibling', (_name, doc, expected) => {
    const state = stateWithSelection(doc, doc.indexOf('child'));
    const result = applyPlan(state, 'indent');

    expect(result.plan.kind).toBe('changes');
    expect(result.state.doc.toString()).toBe(expected);
  });

  it('moves an item and its complete descendant subtree', () => {
    const doc = '- A\n- B\n  - C\n    - D\n- E';
    const state = stateWithSelection(doc, doc.indexOf('B'));

    expect(applyPlan(state, 'indent').state.doc.toString()).toBe(
      '- A\n  - B\n    - C\n      - D\n- E'
    );
  });

  it('supports repeated structural levels when each level has a valid parent', () => {
    const doc = '- A\n  - B\n    - C\n    - D';
    const state = stateWithSelection(doc, doc.lastIndexOf('D'));

    expect(applyPlan(state, 'indent').state.doc.toString()).toBe(
      '- A\n  - B\n    - C\n      - D'
    );
  });

  it('moves multiple selected siblings together under one preceding sibling', () => {
    const doc = '- A\n- B\n- C\n- D';
    const selection = selectText(doc, '- B', '- C');
    const state = stateWithSelection(doc, selection.anchor, selection.head);

    expect(applyPlan(state, 'indent').state.doc.toString()).toBe(
      '- A\n  - B\n  - C\n- D'
    );
  });

  it('excludes a next line touched only by the selection endpoint', () => {
    const doc = '- A\n- B\n- C';
    const secondLine = stateWithSelection(doc, 0).doc.line(2);
    const thirdLine = stateWithSelection(doc, 0).doc.line(3);
    const state = stateWithSelection(doc, secondLine.from, thirdLine.from);

    expect(applyPlan(state, 'indent').state.doc.toString()).toBe('- A\n  - B\n- C');
  });

  it('rejects the whole selection when any independent list group is invalid', () => {
    const doc = '- A\n  - B\n- C';
    const selection = selectText(doc, '  - B', '- C');
    const state = stateWithSelection(doc, selection.anchor, selection.head);

    expect(planListIndentation(state, 'indent')).toEqual({ kind: 'invalid' });
  });

  it('outdents an item and its descendants by one parent level', () => {
    const doc = '- A\n  - B\n    - C\n- D';
    const state = stateWithSelection(doc, doc.indexOf('B'));

    expect(applyPlan(state, 'outdent').state.doc.toString()).toBe(
      '- A\n- B\n  - C\n- D'
    );
  });
});

describe('editor indentation commands', () => {
  it('delegates prose to standard indentation and preserves CommonMark code semantics', () => {
    const initial = stateWithSelection('\ntext', 2);
    const mutable = mutableView(initial);

    expect(indentEditorSelection(mutable.view)).toBe(true);
    expect(indentEditorSelection(mutable.view)).toBe(true);
    expect(mutable.state.doc.toString()).toBe('\n    text');
    expect(syntaxTree(mutable.state).toString()).toContain('CodeBlock');
  });

  it('uses standard indentation for an entire mixed prose/list selection', () => {
    const doc = 'text\n- item';
    const mutable = mutableView(stateWithSelection(doc, 0, doc.length));

    expect(indentEditorSelection(mutable.view)).toBe(true);
    expect(mutable.state.doc.toString()).toBe('  text\n  - item');
  });

  it('applies list indentation as one undoable transaction and maps the caret', () => {
    const doc = '- A\n- B';
    const mutable = mutableView(stateWithSelection(doc, doc.indexOf('B'), undefined, [history()]));
    const originalHead = mutable.state.selection.main.head;

    expect(indentEditorSelection(mutable.view)).toBe(true);
    expect(mutable.state.doc.toString()).toBe('- A\n  - B');
    expect(mutable.state.selection.main.head).toBe(originalHead + 2);
    expect(undo(mutable.view)).toBe(true);
    expect(mutable.state.doc.toString()).toBe(doc);
    expect(mutable.state.selection.main.head).toBe(originalHead);
  });

  it('consumes invalid list indentation instead of falling back to raw spaces', () => {
    const doc = '- first\n- second';
    const mutable = mutableView(stateWithSelection(doc, doc.indexOf('first')));

    expect(indentEditorSelection(mutable.view)).toBe(true);
    expect(mutable.state.doc.toString()).toBe(doc);
  });

  it('delegates prose outdent to the standard command', () => {
    const mutable = mutableView(stateWithSelection('  text', 3));

    expect(outdentEditorSelection(mutable.view)).toBe(true);
    expect(mutable.state.doc.toString()).toBe('text');
  });
});
