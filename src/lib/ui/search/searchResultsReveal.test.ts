import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchResultsReveal } from './searchResultsReveal';

afterEach(() => vi.unstubAllGlobals());

function panel(reduced: boolean, open = true) {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
  const shell = { dataset: { searchOpen: String(open) } };
  const node = { closest: (selector: string) => selector === '.shared-search-bar-shell' ? shell : null } as unknown as HTMLElement;
  return searchResultsReveal(node);
}

describe('shared discovery popup reveal', () => {
  it('honors reduced motion for both opening and dismissal', () => {
    const transition = panel(true, false);
    expect(transition({ direction: 'in' })).toMatchObject({ duration: 0, delay: 0 });
    expect(transition({ direction: 'out' })).toMatchObject({ duration: 0, delay: 0 });
  });

  it('retains a dismissal transition but replaces live panel content immediately', () => {
    expect(panel(false, false)({ direction: 'out' }).duration).toBeGreaterThan(0);
    expect(panel(false)({ direction: 'out' }).duration).toBe(0);
  });
});
