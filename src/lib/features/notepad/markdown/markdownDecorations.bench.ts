import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { createMarkdownLanguage } from './markdownLanguage';
import { buildMarkdownDecorations } from './markdownExtensions';
import { markdownCodeRanges } from './codeContext';
import { markdownFixture as doc } from '../../../../../scripts/benchmarks/workloads.mjs';
import { measure } from '../../../../../scripts/benchmarks/register';

let state = EditorState.create({ doc, extensions: [createMarkdownLanguage()] });
ensureSyntaxTree(state, doc.length, 5000);
state = state.update({}).state;
const visibleRanges = [{ from: 0, to: doc.length }];
const a = { state, visibleRanges } as unknown as EditorView;
const b = { state: state.update({ selection: { anchor: doc.length } }).state, visibleRanges } as unknown as EditorView;
let sink: unknown;
function summarizeDecorations(view: EditorView) {
  const ranges: [number, number][] = [];
  buildMarkdownDecorations(view).decorations.between(0, doc.length, (from, to) => { ranges.push([from, to]); });
  return { count: ranges.length, first: ranges[0], last: ranges.at(-1) };
}

describe(`full-document decoration work (${doc.length} UTF-16 units, 500 sections)`, () => {
  test('one pane selection rebuild', async ({ bench }) => {
    const summary = summarizeDecorations(a);
    expect(summary.count).toBeGreaterThan(500);
    expect(summary.first?.[0]).toBe(0);
    expect(summary.last?.[1]).toBeLessThanOrEqual(doc.length);
    await measure(bench, 'markdown-one-pane', () => { sink = buildMarkdownDecorations(a); });
  });
  test('two pane selection rebuilds', async ({ bench }) => {
    const first = summarizeDecorations(a), second = summarizeDecorations(b);
    expect(first.count).toBeGreaterThan(500);
    expect(second.count).toBeGreaterThan(500);
    expect(first.last?.[1]).toBeLessThanOrEqual(doc.length);
    expect(second.last?.[1]).toBeLessThanOrEqual(doc.length);
    await measure(bench, 'markdown-two-panes', () => {
      sink = buildMarkdownDecorations(a);
      sink = buildMarkdownDecorations(b);
    });
  });
  test('new document code context', async ({ bench }) => {
    expect(markdownCodeRanges(EditorState.create({ doc }).doc)).toEqual([]);
    await measure(bench, 'markdown-code-fresh', () => {
      sink = markdownCodeRanges(EditorState.create({ doc }).doc);
    });
  });
  test('shared code context cached selection query', async ({ bench }) => {
    expect(markdownCodeRanges(state.doc)).toEqual([]);
    await measure(bench, 'markdown-code-cached', () => { sink = markdownCodeRanges(state.doc); });
  });
});
