import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { buildMarkdownDecorations } from './markdownExtensions';
import { createMarkdownLanguage } from './markdownLanguage';
import { markdownBenchmarkFixture } from './markdownBenchmarkFixtures';

function parsed(doc: string) {
  const state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [createMarkdownLanguage()] });
  expect(ensureSyntaxTree(state, doc.length, 10_000)).not.toBeNull();
  return state.update({}).state;
}

function view(state: EditorState, fromLine: number, toLine: number) {
  return { state, visibleRanges: [{ from: state.doc.line(fromLine).from, to: state.doc.line(toLine).to }] } as unknown as EditorView;
}

function ranges(set: DecorationSet) {
  const result: { from: number; to: number; value: Decoration }[] = [];
  for (let cursor = set.iter(); cursor.value; cursor.next()) result.push({ from: cursor.from, to: cursor.to, value: cursor.value });
  return result;
}

describe('visible Markdown presentation', () => {
  for (const kind of ['fence', 'quote'] as const) {
    it(`bounds line decorations and marks inside a huge ${kind}`, () => {
      const state = parsed(markdownBenchmarkFixture(kind, 10_000));
      const pane = view(state, 5_000, 5_039);
      const built = ranges(buildMarkdownDecorations(pane).decorations);
      expect(built.length).toBeGreaterThanOrEqual(40);
      expect(built.length).toBeLessThan(300);
      expect(built.every(range => range.from >= pane.visibleRanges[0].from && range.to <= pane.visibleRanges[0].to)).toBe(true);
      expect(built.filter(range => range.value.spec.class === `cm-gn-${kind === 'fence' ? 'code-block' : 'quote'}-line`)).toHaveLength(kind === 'quote' ? 80 : 40);
      // The viewport starts inside the block; styling needs enclosing syntax.
      if (kind === 'quote') expect(built.some(range => range.value.spec.class === 'cm-gn-quote-content')).toBe(true);
    });
  }

  it('merges overlapping windows and visits enclosing nodes only once', () => {
    const state = parsed(markdownBenchmarkFixture('quote', 100));
    const pane = view(state, 40, 45);
    const expected = ranges(buildMarkdownDecorations(pane).decorations);
    const overlapping = { state, visibleRanges: [
      { from: state.doc.line(42).from, to: state.doc.line(45).to },
      { from: state.doc.line(40).from, to: state.doc.line(43).to }
    ] } as unknown as EditorView;
    expect(ranges(buildMarkdownDecorations(overlapping).decorations)).toEqual(expected);
    const split = { state, visibleRanges: [
      { from: state.doc.line(40).from, to: state.doc.line(41).to },
      { from: state.doc.line(44).from, to: state.doc.line(45).to }
    ] } as unknown as EditorView;
    const built = ranges(buildMarkdownDecorations(split).decorations);
    expect(built.filter(range => range.value.spec.class === 'cm-gn-quote-line')).toHaveLength(8);
    expect(built.filter(range => range.value.spec.class === 'cm-gn-quote-content')).toHaveLength(4);
  });

  it('keeps nested quote reveal local to the owning quote selection', () => {
    const state = parsed('> outer\n> > inner **bold**\n> tail\n\noutside');
    const pane = view(state, 2, 2);
    const concealed = ranges(buildMarkdownDecorations(pane).decorations);
    expect(concealed.filter(range => !range.value.spec.class)).toHaveLength(4);
    const editingInner = { ...pane, state: state.update({ selection: { anchor: 16 } }).state } as unknown as EditorView;
    const innerReplacements = ranges(buildMarkdownDecorations(editingInner).decorations).filter(range => !range.value.spec.class);
    expect(innerReplacements).toHaveLength(2); // Bold remains inactive inside the active quote.
    expect(innerReplacements.every(range => range.from >= 18)).toBe(true);
    const editingOuter = { ...pane, state: state.update({ selection: { anchor: 3 } }).state } as unknown as EditorView;
    const replacements = ranges(buildMarkdownDecorations(editingOuter).decorations).filter(range => !range.value.spec.class);
    expect(replacements.some(range => range.from === 8)).toBe(false);
    expect(replacements.some(range => range.from === 10)).toBe(true);
  });

  it('keeps atomic indentation and aliased wikilinks in each newly exposed window', () => {
    const state = parsed('top\n\n- parent\n  - child [[Target|alias]]\n\noutside');
    const pane = view(state, 4, 4);
    const atoms = ranges(buildMarkdownDecorations(pane).atomicRanges);
    expect(atoms).toHaveLength(2);
    expect(atoms.some(range => range.value.spec.gnAtomicIndent)).toBe(true);
    expect(atoms.some(range => range.value.spec.gnAtomic)).toBe(true);
    const alias = state.doc.toString().indexOf('alias');
    const active = { ...pane, state: state.update({ selection: { anchor: alias, head: alias + 2 } }).state } as unknown as EditorView;
    expect(ranges(buildMarkdownDecorations(active).atomicRanges)).toHaveLength(1);
    expect(ranges(buildMarkdownDecorations(pane).atomicRanges)).toHaveLength(2);
  });

  it('reformats beyond a changed fence when the published tree changes', () => {
    const state = parsed('top\n\n```\nplain\n```\n\n## Heading\n\noutside');
    expect(ranges(buildMarkdownDecorations(view(state, 7, 7)).decorations).some(range => range.value.spec.class === 'cm-gn-line-h2')).toBe(true);
    let next = state.update({ changes: { from: 14, to: 17 } }).state;
    ensureSyntaxTree(next, next.doc.length, 1000);
    next = next.update({}).state;
    const code = ranges(buildMarkdownDecorations(view(next, 7, 7)).decorations);
    expect(code.some(range => range.value.spec.class === 'cm-gn-line-h2')).toBe(false);
    expect(code.some(range => range.value.spec.class === 'cm-gn-code-block-line')).toBe(true);
  });
});
