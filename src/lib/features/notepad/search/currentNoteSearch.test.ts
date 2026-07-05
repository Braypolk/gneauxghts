import { describe, expect, it } from 'vitest';
import { buildCurrentNoteSearchResults } from '$lib/features/notepad/search/currentNoteSearch';

function searchCurrent(query: string, markdown: string, options = {}) {
  return buildCurrentNoteSearchResults({
    title: 'Current',
    noteId: null,
    notePath: '/vault/current.md',
    markdown,
    query,
    matchCase: false,
    matchWholeWord: false,
    ...options
  });
}

describe('buildCurrentNoteSearchResults', () => {
  it('matches case-insensitively by default', () => {
    const results = searchCurrent('atlas', 'Atlas\natlas');

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.startLine)).toEqual([1, 2]);
  });

  it('supports match case', () => {
    const results = searchCurrent('atlas', 'Atlas\natlas', { matchCase: true });

    expect(results).toHaveLength(1);
    expect(results[0]?.startLine).toBe(2);
  });

  it('supports whole word', () => {
    const results = searchCurrent('cat', 'cat scatter cat', { matchWholeWord: true });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.matchText)).toEqual(['cat', 'cat']);
  });

  it('supports combined match case and whole word', () => {
    const results = searchCurrent('Cat', 'cat Cat Cattle Cat', {
      matchCase: true,
      matchWholeWord: true
    });

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.matchText === 'Cat')).toBe(true);
  });

  it('returns multiple matches on the same line with ranges', () => {
    const results = searchCurrent('note', 'note note');

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.currentMatchRange)).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 9 }
    ]);
  });

  it('returns no matches for absent text', () => {
    expect(searchCurrent('missing', 'body')).toEqual([]);
  });
});
