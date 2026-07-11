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
  it('passes case and whole-word options to the search engine', () => {
    const results = searchCurrent('Cat', 'cat Cat Cattle Cat', {
      matchCase: true,
      matchWholeWord: true
    });

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.matchText === 'Cat')).toBe(true);
  });

  it('maps matches to note metadata, lines, and document ranges', () => {
    const results = searchCurrent('note', 'intro\nnote note');

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.startLine)).toEqual([2, 2]);
    expect(results.map((result) => result.currentMatchRange)).toEqual([
      { from: 6, to: 10 },
      { from: 11, to: 15 }
    ]);
    expect(results[0]).toMatchObject({
      notePath: '/vault/current.md',
      fileName: 'Current',
      sectionLabel: 'Line 2',
      matchText: 'note',
      reasonLabels: ['keyword']
    });
  });

  it('returns no results for empty or absent queries', () => {
    expect(searchCurrent('  ', 'body')).toEqual([]);
    expect(searchCurrent('missing', 'body')).toEqual([]);
  });
});
