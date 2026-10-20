import { markdownLanguage } from '@codemirror/lang-markdown';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';

// Diagnostic ablation: direct, complete parses in Node. These numbers identify
// grammar costs; they are not editor dispatch or native latency measurements.
const rows = [];
for (const lines of [1_000, 10_000, 50_000]) {
  const fixtures = {
    original: '> > quoted **bold** text\n'.repeat(lines),
    // Preserve character count, quote depth and line count; remove emphasis.
    noInlineEmphasis: '> > quoted   bold   text\n'.repeat(lines),
    // Preserve original lines; break the single long paragraph every 25 lines.
    paragraphBreaks: Array.from({ length: lines }, (_, i) => '> > quoted **bold** text\n' + (i % 25 === 24 ? '> >\n' : '')).join('')
  };
  for (const [variant, markdown] of Object.entries(fixtures)) {
    const samplesMs = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const tree = markdownLanguage.parser.parse(markdown);
      const elapsed = performance.now() - start;
      if (tree.length !== markdown.length) throw new Error('Incomplete diagnostic parse');
      if (i >= 2) samplesMs.push(elapsed);
    }
    samplesMs.sort((a, b) => a - b);
    rows.push({ lines, variant, characters: markdown.length, medianMs: samplesMs[2], samplesMs });
  }
}
console.log(JSON.stringify({ runtime: process.version, cpu: cpus()[0]?.model,
  parser: '@lezer/markdown via installed markdownLanguage', warmups: 2, samples: 5,
  description: 'Direct complete grammar parse, no editor, DOM, custom extensions, history or callbacks.', rows }, null, 2));
