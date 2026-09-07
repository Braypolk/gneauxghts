import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import HistoryDiff from './HistoryDiff.svelte';
import type { HistoricalDiff } from './historyModeMachine';

const diff: HistoricalDiff = {
  revisionId: 'revision-2',
  comparison: 'parent',
  fromRevisionId: 'revision-1',
  toRevisionId: 'revision-2',
  bodyLines: [
    { kind: 'context', text: 'Kept\n', oldLineNumber: 1, newLineNumber: 1 },
    { kind: 'removed', text: '*old*\n', oldLineNumber: 2, newLineNumber: null },
    { kind: 'added', text: '**new**\n', oldLineNumber: null, newLineNumber: 2 },
    {
      kind: 'added',
      text: '![[missing.png]]\n',
      oldLineNumber: null,
      newLineNumber: 3
    }
  ],
  propertiesLines: [
    {
      kind: 'removed',
      text: 'project: atlas\n',
      oldLineNumber: 1,
      newLineNumber: null
    },
    {
      kind: 'added',
      text: 'project: zeus\n',
      oldLineNumber: null,
      newLineNumber: 1
    }
  ],
  missingAssets: ['missing.png']
};

describe('HistoryDiff', () => {
  it('collapses long unchanged sections while retaining context and every change', () => {
    const bodyLines: HistoricalDiff['bodyLines'] = Array.from({ length: 100 }, (_, index) => ({
      kind: 'context', text: `context-${index}\n`, oldLineNumber: index + 1, newLineNumber: index + 1
    }));
    bodyLines[50] = { kind: 'added', text: 'changed-line\n', oldLineNumber: null, newLineNumber: 51 };
    const body = render(HistoryDiff, { props: { diff: { ...diff, bodyLines } } }).body;
    expect(body).toContain('Show all unchanged lines');
    expect(body).toContain('changed-line');
    expect(body).toContain('context-47');
    expect(body).toContain('context-53');
    expect(body).not.toContain('context-0<');
    expect(body).not.toContain('context-99<');
    expect(body).toContain('47 unchanged lines');
    expect(body).toContain('46 unchanged lines');
    expect(body).not.toContain('context-20');
    expect(body).not.toContain('context-80');
  });

  it('retains context on both sides of separated changes without duplicate lines', () => {
    const bodyLines: HistoricalDiff['bodyLines'] = Array.from({ length: 20 }, (_, index) => ({
      kind: index === 2 || index === 12 ? 'added' : 'context',
      text: `line-${index}\n`, oldLineNumber: index + 1, newLineNumber: index + 1
    }));
    const body = render(HistoryDiff, { props: { diff: { ...diff, bodyLines, propertiesLines: [] } } }).body;
    for (const index of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15]) {
      expect(body.match(new RegExp(`line-${index}<`, 'gu'))).toHaveLength(1);
    }
    for (const index of [6, 7, 8, 16, 17, 18, 19]) {
      expect(body).not.toContain(`line-${index}<`);
    }
    expect(body).toContain('3 unchanged lines');
    expect(body).toContain('4 unchanged lines');
  });

  it('renders complete authored changes, disclosed properties, and missing assets', () => {
    const body = render(HistoryDiff, { props: { diff } }).body;

    expect(body).toContain('Compared with previous revision');
    expect(body).toContain('Kept');
    expect(body).toContain('*old*');
    expect(body).toContain('**new**');
    expect(body).toContain('![[missing.png]]');
    expect(body).toContain('<summary');
    expect(body).toContain('Properties');
    expect(body).toContain('project: atlas');
    expect(body).toContain('project: zeus');
    expect(body).toContain('missing.png');
    expect(body).toContain('not stored in Note Timeline history');
    expect(body).not.toContain('gneauxghts');
  });

  it('reports an authored no-op explicitly', () => {
    const body = render(HistoryDiff, {
      props: {
        diff: {
          ...diff,
          bodyLines: [
            { kind: 'context', text: 'Unchanged', oldLineNumber: 1, newLineNumber: 1 }
          ],
          propertiesLines: [],
          missingAssets: []
        }
      }
    }).body;

    expect(body).toContain('No authored body changes');
    expect(body).not.toContain('<summary');
  });
});
