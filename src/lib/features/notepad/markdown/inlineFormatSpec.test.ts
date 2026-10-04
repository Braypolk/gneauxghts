import { describe, expect, it } from 'vitest';
import { syntaxTree } from '@codemirror/language';
import { createCommandView } from '../editor/commandTestSupport';
import { applyInlineFormat } from '../editor/inlineFormatting';
import { createMarkdownLanguage } from './markdownLanguage';
import { buildMarkdownDecorations } from './markdownExtensions';
import { INLINE_WRAP_FORMATS, getWrapFormatIds } from './inlineFormatSpec';

describe('supported inline format contracts', () => {
  it('exposes the intended unique command set', () => {
    expect(getWrapFormatIds().slice().sort()).toEqual(['bold', 'code', 'comment', 'highlight', 'italic', 'strikethrough']);
    expect(new Set(INLINE_WRAP_FORMATS.map(spec => spec.syntaxNode)).size).toBe(INLINE_WRAP_FORMATS.length);
  });
  for (const spec of INLINE_WRAP_FORMATS) {
    it(`${spec.id} travels from command through parser and composed decorations`, () => {
      const { view } = createCommandView({ doc: 'before text after', selection: { anchor: 7, head: 11 }, extensions: [createMarkdownLanguage()] });
      expect(applyInlineFormat(view, spec.id)).toBe(true);
      const nodes: string[] = []; syntaxTree(view.state).iterate({ enter(node) { nodes.push(node.name); } });
      expect(nodes).toContain(spec.syntaxNode);
      view.dispatch({ selection: { anchor: 0 } });
      const classes: string[] = [];
      const concealed: [number, number][] = [];
      const built = buildMarkdownDecorations(view);
      built.decorations.between(0, view.state.doc.length, (from, to, decoration) => {
        if (decoration.spec.class) classes.push(decoration.spec.class);
        else concealed.push([from, to]);
      });
      expect(classes).toContain(spec.contentClass);
      const delimiterLength = spec.defaultDelimiter.before.length;
      expect(concealed).toEqual([[7, 7 + delimiterLength], [11 + delimiterLength, 11 + delimiterLength * 2]]);
      view.dispatch({ selection: { anchor: 7 + spec.defaultDelimiter.before.length, head: 11 + spec.defaultDelimiter.before.length } });
      expect(applyInlineFormat(view, spec.id)).toBe(true); expect(view.state.doc.toString()).toBe('before text after');
    });
  }
});
