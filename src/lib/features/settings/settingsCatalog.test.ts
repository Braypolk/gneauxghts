import { describe, expect, it } from 'vitest';
import { searchSettings } from './settingsCatalog';

describe('settings discovery', () => {
  it('puts precise setting names before broad descriptions', () => {
    expect(searchSettings('Theme')[0].id).toBe('theme');
    expect(searchSettings('Clear vault history')[0].id).toBe('clear-history');
  });

  it('requires all words but ignores punctuation, accents, and whitespace', () => {
    expect(searchSettings('  API—KÉY  ').map((entry) => entry.id)).toEqual(searchSettings('api key').map((entry) => entry.id));
    expect(searchSettings('theme nonexistent')).toEqual([]);
  });

  it('does not offer an inactive web-search setting', () => {
    expect(searchSettings('web access')).toEqual([]);
    expect(searchSettings('browsing')).toEqual([]);
  });

  it.each(['inline diff', 'side by side', 'edit review'])('finds the edit diff preference from %s', query => {
    expect(searchSettings(query)).toContainEqual(expect.objectContaining({ id: 'diff-layout', category: 'appearance', anchor: 'diff-layout' }));
  });

  it.each(['write permissions', 'default note editing'])('finds editing defaults from %s', query => {
    expect(searchSettings(query)).toContainEqual(expect.objectContaining({ id: 'write-access', category: 'ai', anchor: 'chat-write-access' }));
  });

  it.each(['', '  ', '!!!', 'unfindablesetting'])('returns no results for %j', (query) => {
    expect(searchSettings(query)).toEqual([]);
  });
});
