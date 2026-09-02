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
