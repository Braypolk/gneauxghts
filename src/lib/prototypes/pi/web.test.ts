import { describe, expect, it } from 'vitest';
import { vaultSources, webSourcesFromText } from './web';

describe('Pi authored web sources', () => {
  it('extracts deduplicated authored HTTP(S) links using the existing source policy', () => {
    const text = 'Fact [source](https://example.com/path?q=1). Again https://example.com/path?q=1! Other <http://example.org/a>.';
    const sources = webSourcesFromText(text);
    expect(sources.map(source => source.url)).toEqual(['https://example.com/path?q=1', 'http://example.org/a']);
    expect(sources.every(source => source.kind === 'web' && !source.passage && !source.noteId && source.excerpt === '')).toBe(true);
    expect(text).toContain('[source](https://example.com/path?q=1)');
  });

  it('does not grant evidence authority to web links or unread metadata', () => {
    const passage = { kind: 'passage', title: 'Read source', excerpt: 'Delivered text', noteId: 'note-1' };
    expect(vaultSources([...webSourcesFromText('https://example.com'), passage])).toEqual([passage]);
    expect(webSourcesFromText('Unread note title and [S999] and passage:invented')).toEqual([]);
    expect(webSourcesFromText('')).toEqual([]);
  });
});
