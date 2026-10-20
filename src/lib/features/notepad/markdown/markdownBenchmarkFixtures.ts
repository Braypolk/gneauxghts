/** Fixed-width lines; every workload exposes 40 lines regardless of note size. */
export const markdownBenchmarkSizes = [1_000, 10_000, 50_000] as const;
export const markdownBenchmarkKinds = ['mixed', 'fence', 'quote'] as const;
export type MarkdownBenchmarkKind = typeof markdownBenchmarkKinds[number];

export function markdownBenchmarkFixture(kind: MarkdownBenchmarkKind, lines: number) {
  if (kind === 'fence') return '```\n' + 'const value = 123;\n'.repeat(lines) + '```\n\noutside';
  if (kind === 'quote') return '> > quoted **bold** text\n'.repeat(lines) + '\noutside';
  return Array.from({ length: lines }, (_, i) => [
    `## Heading ${i}`, '', 'Prose **bold** and [[Note|alias]] with ==highlight==.', '',
    '- parent', '  - [ ] task', '', '> quoted *text*', '', '---', ''
  ][i % 11]).join('\n') + '\noutside';
}
