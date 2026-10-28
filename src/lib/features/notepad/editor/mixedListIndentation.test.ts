import { describe, expect, it } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { createCommandView } from './commandTestSupport';
import { applyBlockTypeSelection } from './blockTypes';
import { createMarkdownLanguage } from '../markdown/markdownLanguage';
import { createIndentExtensions } from './indentConfig';
import { indentEditorSelection, outdentEditorSelection } from './structuralIndentation';
import { markdownEnter } from './editorShortcuts';

const styles = [
  { id: 'orderedList', marker: '1.', width: 3 },
  { id: 'letterList', marker: 'a.', width: 3 },
  { id: 'bulletList', marker: '-', width: 2 },
  { id: 'taskList', marker: '- [ ]', width: 2 }
] as const;

function editor(doc: string, text: string, endText?: string) {
  const anchor = doc.indexOf(text);
  const head = endText ? doc.indexOf(endText) + endText.length : anchor;
  return createCommandView({ doc, selection: { anchor, head },
    extensions: [createMarkdownLanguage(), ...createIndentExtensions(), history()] });
}

function itemDepths(view: ReturnType<typeof editor>['view']) {
  const depths: number[] = [];
  syntaxTree(view.state).iterate({ enter(ref) {
    if (ref.name !== 'ListItem') return;
    let depth = 0;
    for (let parent = ref.node.parent; parent; parent = parent.parent) {
      if (parent.name === 'ListItem') depth++;
    }
    depths.push(depth);
  } });
  return depths;
}

describe('mixed list levels', () => {
  for (const parent of styles) for (const child of styles) {
    it(`keeps ${child.id} beneath ${parent.id} when changing list style`, () => {
      const input = `${parent.marker} Parent\n${' '.repeat(parent.width)}${parent.marker} Child`;
      const { view } = editor(input, 'Child');
      applyBlockTypeSelection(view, child.id);
      expect(view.state.doc.toString()).toBe(`${parent.marker} Parent\n${' '.repeat(parent.width)}${child.marker} Child`);
      expect(itemDepths(view)).toEqual([0, 1]);
      expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf('Child'));
    });

    it(`round trips ${child.id} under ${parent.id}, including its subtree`, () => {
      const root = `${parent.marker} Parent\n${child.marker} Child\n${' '.repeat(child.width)}- Grandchild`;
      const { view } = editor(root, 'Child');
      indentEditorSelection(view);
      expect(itemDepths(view)).toEqual([0, 1, 2]);
      expect(view.state.doc.toString()).toBe(`${parent.marker} Parent\n${' '.repeat(parent.width)}${child.marker} Child\n${' '.repeat(parent.width + child.width)}- Grandchild`);
      outdentEditorSelection(view);
      expect(view.state.doc.toString()).toBe(root);
      expect(itemDepths(view)).toEqual([0, 0, 1]);
    });
  }

  it('keeps a following numbered item structural when its previous sibling becomes lettered', () => {
    const { view } = editor('1. Parent\n2. Child', 'Parent');
    applyBlockTypeSelection(view, 'letterList');
    expect(itemDepths(view)).toEqual([0, 0]);
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('Child') } });
    indentEditorSelection(view);
    expect(view.state.doc.toString()).toBe('a. Parent\n   2. Child');
    expect(itemDepths(view)).toEqual([0, 1]);
  });

  it('keeps later lettered siblings structural after converting the first lettered item', () => {
    const { view } = editor('1. Parent\n   a. First\n   b. Second', 'First');
    applyBlockTypeSelection(view, 'bulletList');
    expect(view.state.doc.toString()).toBe('1. Parent\n   - First\n   b. Second');
    expect(itemDepths(view)).toEqual([0, 1, 1]);
  });

  it('changes one level per key through nine alternating levels', () => {
    const lines: string[] = [];
    let column = 0;
    for (let level = 0; level < 9; level++) {
      const style = styles[level % styles.length];
      lines.push(' '.repeat(column) + style.marker + ` Level ${level}`);
      if (level < 8) column += style.width;
    }
    lines.push(' '.repeat(column) + '1. Target');
    const input = lines.join('\n');
    const { view } = editor(input, 'Target');
    indentEditorSelection(view);
    expect(itemDepths(view).at(-1)).toBe(9);
    outdentEditorSelection(view);
    expect(view.state.doc.toString()).toBe(input);
    for (let level = 7; level >= 0; level--) {
      outdentEditorSelection(view);
      expect(itemDepths(view).at(-1)).toBe(level);
    }
    const atRoot = view.state.doc.toString();
    outdentEditorSelection(view);
    expect(view.state.doc.toString()).toBe(atRoot);
  });

  it('moves selected mixed siblings together without double-indenting descendants', () => {
    const input = '1. Parent\na. First\n   - Descendant\n1. Second';
    const { view } = editor(input, 'a. First', '1. Second');
    indentEditorSelection(view);
    expect(view.state.doc.toString()).toBe('1. Parent\n   a. First\n      - Descendant\n   1. Second');
    expect(itemDepths(view)).toEqual([0, 1, 2, 1]);
    outdentEditorSelection(view);
    expect(view.state.doc.toString()).toBe(input);
  });

  it('preserves grandchildren when a narrower marker replaces the parent marker', () => {
    const input = '1. Root\n   a. Child\n      1. Grandchild\n         - Leaf';
    const { view } = editor(input, 'Child');
    applyBlockTypeSelection(view, 'bulletList');
    expect(view.state.doc.toString()).toBe('1. Root\n   - Child\n     1. Grandchild\n        - Leaf');
    expect(itemDepths(view)).toEqual([0, 1, 2, 3]);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(input);
  });

  it('preserves levels and numbers each selected depth independently', () => {
    const input = '1. Root\n   - First\n     - Grandchild\n   - Second';
    const { view } = editor(input, '- First', '- Second');
    applyBlockTypeSelection(view, 'letterList');
    expect(view.state.doc.toString()).toBe('1. Root\n   a. First\n      a. Grandchild\n   b. Second');
    expect(itemDepths(view)).toEqual([0, 1, 2, 1]);
  });

  it('promotes and demotes a mixed subtree across four levels', () => {
    const input = '1. Root\n   a. First\n      - Earlier\n   b. Second\n      1. Child\n         - Leaf';
    const { view } = editor(input, 'Second');
    indentEditorSelection(view);
    expect(itemDepths(view)).toEqual([0, 1, 2, 2, 3, 4]);
    outdentEditorSelection(view);
    expect(view.state.doc.toString()).toBe(input);
    outdentEditorSelection(view);
    expect(itemDepths(view)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it.each([
    ['a. Parent\n   - Child', 'a. Parent\n   - Child\n   - '],
    ['a. Parent\n   - [x] Child', 'a. Parent\n   - [x] Child\n   - [ ] '],
    ['a. Parent\n   1. Child', 'a. Parent\n   1. Child\n   2. '],
    ['1. Parent\n   a. Child', '1. Parent\n   a. Child\n   b. '],
    ['a. Parent\n   1. Child\n      a. Leaf', 'a. Parent\n   1. Child\n      a. Leaf\n      b. ']
  ])('continues the innermost list of %j', (input, output) => {
    const { view } = editor(input, input);
    view.dispatch({ selection: { anchor: input.length } });
    markdownEnter(view);
    expect(view.state.doc.toString()).toBe(output);
  });
});
