import { createHash } from 'node:crypto';

// Spell out Tinybench 6.2 defaults that affect comparability; measured work
// retains the original 150 ms / 10 iteration limits.
export const runOptions = { time: 150, iterations: 10, warmup: true, warmupTime: 250, warmupIterations: 16 };
export const markdownFixture = Array.from({ length: 500 }, (_, i) => `## Heading ${i}\n\nProse **bold** and [[Note|alias]] with ==highlight==.\n\n| one | two |\n| --- | --- |\n| a | b |\n\n`).join('');
export const imageFixture = Array.from({ length: 500 }, (_, i) => `${'Prose '.repeat(60)}\n\n![[image-${i}.png|200]]\n\n`).join('');

/** @param {string} text @param {Record<string, number>} counts */
const fixture = (text, counts) => ({ sha256: createHash('sha256').update(text).digest('hex'), utf16Length: text.length, ...counts });
const markdown = fixture(markdownFixture, { sections: 500 });
const images = fixture(imageFixture, { images: 500 });
/** @param {string} id @param {ReturnType<typeof fixture>} fixture @param {string} operation @param {string} setup */
const workload = (id, fixture, operation, setup) => ({ id, workloadVersion: 1, fixture, operation, setup, runOptions });
export const workloads = [
  workload('markdown-one-pane', markdown, 'one full-document decoration rebuild', 'shared parsed state; warm syntax tree'),
  workload('markdown-two-panes', markdown, 'two full-document decoration rebuilds', 'shared document; two selections; warm syntax tree'),
  workload('markdown-code-fresh', markdown, 'create Text and calculate code ranges', 'fresh Text/cache miss each iteration'),
  workload('markdown-code-cached', markdown, 'lookup shared document code ranges', 'shared Text; prewarmed code range cache'),
  workload('images-inventory', images, 'create editor state with image extension', 'fresh state/inventory each iteration'),
  workload('images-selection', images, '500 selection-only transactions', 'shared initial state; warm inventory; fresh transaction chain'),
];
