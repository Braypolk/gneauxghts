import { writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { it } from 'vitest';
import { buildMarkdownDecorations } from './markdownExtensions';
import { createMarkdownLanguage } from './markdownLanguage';
import { markdownBenchmarkFixture, markdownBenchmarkKinds, markdownBenchmarkSizes } from './markdownBenchmarkFixtures';

// Opt-in evidence capture, separate from ordinary regressions. State creation,
// parsing and transaction application are deliberately OUTSIDE timed sections.
it.skipIf(!process.env.MARKDOWN_BENCHMARK_OUTPUT)('measures pure decoration rebuilds', () => {
  const rows = [];
  for (const lines of markdownBenchmarkSizes) for (const kind of markdownBenchmarkKinds) {
    const doc = markdownBenchmarkFixture(kind, lines);
    const initial = EditorState.create({ doc, extensions: [createMarkdownLanguage()] });
    if (!ensureSyntaxTree(initial, doc.length, 30_000)) throw new Error('Incomplete benchmark parse');
    const base = initial.update({}).state;
    for (const operation of ['selection', 'document'] as const) for (const panes of [1, 2]) {
      const variants = [0, 1].map(step => Array.from({ length: panes }, (_, pane) => {
        let state = operation === 'selection'
          ? base.update({ selection: { anchor: base.doc.length - 2 - step } }).state
          : base.update({ changes: { from: doc.length - 1, insert: step ? 'x' : 'y' } }).state;
        if (!ensureSyntaxTree(state, state.doc.length, 30_000)) throw new Error('Incomplete edited parse');
        state = state.update({}).state;
        const start = Math.floor(lines * (pane ? 0.75 : 0.25));
        return { state, visibleRanges: [{ from: state.doc.line(start).from, to: state.doc.line(start + 39).to }] } as unknown as EditorView;
      }));
      const samples = [];
      let count = 0;
      for (let i = 0; i < 35; i++) {
        const start = performance.now();
        for (const view of variants[i % 2]) count = buildMarkdownDecorations(view).decorations.size;
        const elapsed = performance.now() - start;
        if (i >= 5) samples.push(elapsed);
      }
      samples.sort((a, b) => a - b);
      rows.push({ kind, lines, units: doc.length, operation, panes, decorationsInLastPane: count,
        medianMs: samples[15], p95Ms: samples[28], samplesMs: samples });
    }
  }
  writeFileSync(process.env.MARKDOWN_BENCHMARK_OUTPUT!, JSON.stringify({
    runtime: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model,
    visibleLines: 40, warmups: 5, samples: 30, rows
  }, null, 2) + '\n');
}, 120_000);
