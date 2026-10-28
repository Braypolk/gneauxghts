import { describe, expect, it } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { createCommandView } from '../editor/commandTestSupport';
import { applyBlockTypeSelection, describeBlockAt, baseListMenuItems } from '../editor/blockTypes';
import { markdownEnter } from '../editor/editorShortcuts';
import { deleteLetterListMarkup } from '../editor/letterListCommands';
import { createMarkdownLanguage } from './markdownLanguage';
import { buildMarkdownDecorations } from './markdownExtensions';

function editor(doc: string, anchor = doc.length, head = anchor) {
  return createCommandView({ doc, selection: EditorSelection.single(anchor, head),
    extensions: [createMarkdownLanguage(), history()] });
}

function tree(doc: string) {
  return syntaxTree(editor(doc).view.state).toString();
}

describe('letter lists', () => {
  it('offers the list option and converts selected lines with alphabetic enumerators', () => {
    expect(baseListMenuItems).toContainEqual({ id: 'letterList', label: 'Letter List' });
    const doc = 'first\nsecond\nthird';
    const { view } = editor(doc, 0, doc.length);
    expect(applyBlockTypeSelection(view, 'letterList')).toBe(true);
    expect(view.state.doc.toString()).toBe('a. first\nb. second\nc. third');
    expect(describeBlockAt(view.state, 0).typeId).toBe('letterList');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it.each(['paragraph', 'orderedList', 'bulletList', 'taskList'])(
    'converts letters to %s without leaving the old marker', kind => {
      const { view } = editor('c. text');
      applyBlockTypeSelection(view, kind);
      expect(view.state.doc.toString()).toBe({ paragraph: 'text', orderedList: '1. text',
        bulletList: '- text', taskList: '- [ ] text' }[kind]);
    });

  it('inserts an empty letter list and puts the caret after its marker', () => {
    const { view } = editor('');
    applyBlockTypeSelection(view, 'letterList');
    expect(view.state.doc.toString()).toBe('a. ');
    expect(view.state.selection.main.head).toBe(3);
  });

  it.each([
    ['a. first', 'a. first\nb. '],
    ['z. last', 'z. last\naa. '],
    ['aa. next', 'aa. next\nab. '],
    ['a. parent\n   a. child', 'a. parent\n   a. child\n   b. '],
    ['- parent\n  a. child', '- parent\n  a. child\n  b. '],
    ['> a. quoted', '> a. quoted\n> b. '],
    ['a. first\nb. ', 'a. first\n'],
    ['a. parent\n   a. ', 'a. parent\n']
  ])('continues or exits %j in one transaction', (doc, expected) => {
    const { view, transactions } = editor(doc);
    expect(markdownEnter(view)).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(view.state.doc.toString()).toBe(expected);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('splits an item and renumbers consecutive following siblings', () => {
    const { view } = editor('a. first item\nb. second\nc. third', 8);
    markdownEnter(view);
    expect(view.state.doc.toString()).toBe('a. first\nb.  item\nc. second\nd. third');
  });

  it('continues each cursor as one transaction', () => {
    const { view, transactions } = createCommandView({ doc: 'a. one\n\na. two',
      selection: EditorSelection.create([EditorSelection.cursor(6), EditorSelection.cursor(14)]),
      extensions: [createMarkdownLanguage(), EditorState.allowMultipleSelections.of(true)] });
    expect(markdownEnter(view)).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(view.state.doc.toString()).toBe('a. one\nb. \n\na. two\nb. ');
  });

  it('removes a letter marker with Backspace at the content start', () => {
    const { view } = editor('a. text', 3);
    expect(deleteLetterListMarkup(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('text');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('a. text');
  });

  it('parses inline formatting, continuation paragraphs and mixed nested lists', () => {
    const parsed = tree('a. **first**\n   continuation\n   - child\nb. second');
    expect(parsed).toBe('Document(LetterList(ListItem(ListMark,Paragraph(StrongEmphasis(EmphasisMark,EmphasisMark)),BulletList(ListItem(ListMark,Paragraph))),ListItem(ListMark,Paragraph)))');
  });

  it('keeps prose, escaped markers and code out of the letter-list grammar', () => {
    for (const doc of ['ordinary. sentence', 'a\\. escaped', '```\na. code\n```', '    a. code']) {
      expect(tree(doc)).not.toContain('LetterList');
    }
    const { view } = editor('```\na. code\n```', 11);
    markdownEnter(view);
    expect(view.state.doc.toString()).toBe('```\na. code\n\n```');
  });

  it('uses ordered-list styling and conceals nested indentation', () => {
    const { view } = editor('a. parent\n   a. child');
    const built = buildMarkdownDecorations(view);
    const classes: string[] = [];
    let atomic = 0;
    built.decorations.between(0, view.state.doc.length, (_from, _to, decoration) => {
      classes.push(decoration.spec.class);
    });
    built.atomicRanges.between(0, view.state.doc.length, (from, to) => { atomic += to - from; });
    expect(classes.filter(c => c === 'cm-gn-list-line-ol')).toHaveLength(2);
    expect(classes.some(c => c?.startsWith('cm-gn-list-mark-ol'))).toBe(true);
    expect(atomic).toBe(3);
  });
});
