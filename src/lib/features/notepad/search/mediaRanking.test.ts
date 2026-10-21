import { describe, expect, it } from 'vitest';
import { rankMediaResults } from './mediaRanking';
import type { ImageSearchItem, SearchItem } from '#lib/types/semantic.js';
const passage = (name: string): SearchItem => ({ noteId: name, notePath: `/vault/${name}.md`, fileName: name, sectionLabel: '', excerpt: 'Canonical text', matchText: 'Canonical text', highlightRanges: [], reasonLabels: [], lexicalScore: null, semanticScore: null, startLine: 1, endLine: 1 });
const image = (name: string, score: number): ImageSearchItem => ({ kind: 'image', noteId: name, notePath: `/vault/${name}.md`, noteTitle: name, noteHash: 'note', assetName: `${name}.png`, assetHash: name, sourceStart: 0, sourceEnd: 12, score });
describe('independent media channel ranks', () => {
  it('interleaves passage and image ranks without comparing cosine scales or inventing quotes', () => {
    const results = rankMediaResults([passage('p1'), passage('p2')], [image('i1', .81), image('i2', .99)]);
    expect(results.map(item => item.noteId)).toEqual(['p1','i1','p2','i2']);
    expect(results[1]).not.toHaveProperty('matchText');
    expect(results[1]).not.toHaveProperty('startLine');
    expect(results[0]).toMatchObject({ kind: 'passage', matchText: 'Canonical text' });
  });
  it('keeps keyword results usable when the image channel is unavailable', () => {
    expect(rankMediaResults([passage('keyword')], [])).toMatchObject([{ kind: 'passage', noteId: 'keyword' }]);
  });
});
