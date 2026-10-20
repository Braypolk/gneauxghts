import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { expect, it } from 'vitest';
import { buildMarkdownDecorations } from './markdownExtensions';
import { createMarkdownLanguage } from './markdownLanguage';

// Recorded from the original production builder, then intersected with windows.
// Compare semantic ranges (ignoring redundant identical ranges) to protect the
// existing appearance, including the quote continuation-marker behavior.
const fixture = [
  '# Heading', '', '**bold** *italic* ~~strike~~ ==highlight== `code`', '',
  '- parent', '  - [ ] task [[Target|alias]]', '  - child', '',
  '> outer', '> continued', '> > nested **bold**', '> > continued', '> tail', '',
  '```js', 'let a = 1;', 'let b = 2;', '```', '',
  '[label](https://example.com "title") and \\*escaped\\*', '', '---', '', 'outside'
].join('\n');
const goldenPath = fileURLToPath(new URL('./markdownAppearance.json', import.meta.url));

it('preserves the original presentation throughout bounded windows and selections', () => {
  const initial = EditorState.create({ doc: fixture, extensions: [createMarkdownLanguage()] });
  ensureSyntaxTree(initial, fixture.length, 5000);
  const base = initial.update({}).state;
  const results = [];
  for (const selection of [
    { anchor: fixture.length }, { anchor: 4 }, { anchor: 17 },
    { anchor: fixture.indexOf('alias') }, { anchor: fixture.indexOf('nested') },
    { anchor: 0, head: fixture.length },
    { anchor: fixture.indexOf('highlight'), head: fixture.indexOf('highlight') + 3 }
  ]) for (const [first, last] of [[1, 24], [5, 7], [10, 12], [16, 16], [20, 22]]) {
    const state = base.update({ selection }).state;
    const from = state.doc.line(first).from, to = state.doc.line(last).to;
    const pane = { state, visibleRanges: [{ from, to }] } as unknown as EditorView;
    const ranges = [];
    for (const cursor = buildMarkdownDecorations(pane).decorations.iter(); cursor.value; cursor.next()) {
      const { value } = cursor;
      const low = value.point ? cursor.from : Math.max(from, cursor.from);
      const high = value.point ? cursor.to : Math.min(to, cursor.to);
      if (cursor.from > to || cursor.to < from || (!value.point && low >= high)) continue;
      ranges.push(JSON.stringify({ from: low, to: high, class: value.spec.class,
        attributes: value.spec.attributes, atomic: value.spec.gnAtomic || value.spec.gnAtomicIndent,
        point: value.point, widget: value.spec.widget && { ...value.spec.widget } }));
    }
    results.push({ selection, first, last, ranges: [...new Set(ranges)].sort() });
  }
  if (process.env.RECORD_MARKDOWN_APPEARANCE === '1') writeFileSync(goldenPath, JSON.stringify(results, null, 2) + '\n');
  else expect(results).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
});
