import { describe, expect, it } from 'vitest';
import { textMatchesSearch } from './searchMatch';

describe('textMatchesSearch', () => {
  it('matches case-insensitively by default', () => {
    expect(textMatchesSearch('Project Atlas', 'atlas')).toBe(true);
  });

  it('respects match case', () => {
    expect(textMatchesSearch('Project Atlas', 'atlas', { matchCase: true })).toBe(false);
    expect(textMatchesSearch('Project Atlas', 'Atlas', { matchCase: true })).toBe(true);
  });

  it('respects whole-word matching', () => {
    expect(textMatchesSearch('scatter cat category', 'cat', { matchWholeWord: true })).toBe(true);
    expect(textMatchesSearch('scatter category', 'cat', { matchWholeWord: true })).toBe(false);
  });

  it('treats an empty query as a match', () => {
    expect(textMatchesSearch('anything', '')).toBe(true);
    expect(textMatchesSearch('anything', '   ')).toBe(true);
  });
});
