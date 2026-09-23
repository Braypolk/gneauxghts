import { describe, expect, it } from 'vitest';
import { searchSettings } from './settingsCatalog';

describe('settings discovery', () => {
  it.each([
    ['FONT', 'text-size'],
    ['trash', 'forgotten'],
    ['api-key', 'api-keys'],
    ['local endpoint', 'endpoint'],
    ['disk space', 'storage'],
    ['privacy', 'excluded'],
    ['pause indexing', 'automatic-indexing'],
    ['prepare local model', 'prepare-model'],
    ['download model', 'download-model'],
    ['retry index', 'index']
  ])('finds %s across category boundaries', (query, id) => {
    expect(searchSettings(query).map((entry) => entry.id)).toContain(id);
  });

  it('puts precise setting names before broad descriptions', () => {
    expect(searchSettings('Theme')[0].id).toBe('theme');
    expect(searchSettings('Clear vault history')[0].id).toBe('clear-history');
  });

  it('requires all words but ignores punctuation, accents, and whitespace', () => {
    expect(searchSettings('  API—KÉY  ').map((entry) => entry.id)).toEqual(searchSettings('api key').map((entry) => entry.id));
    expect(searchSettings('theme nonexistent')).toEqual([]);
  });

  it.each(['', '  ', '!!!', 'unfindablesetting'])('returns no results for %j', (query) => {
    expect(searchSettings(query)).toEqual([]);
  });
});
