import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('edit diff layout preference', () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([undefined, 'unknown', 'inline'])('defaults to inline for stored value %s', async (value) => {
    if (value) storage.set('gneauxghts.edit-diff-layout', value);
    expect((await import('./editDiffLayout.svelte')).editDiffLayout.preference).toBe('inline');
  });

  it('persists either choice across module initialization', async () => {
    let store = (await import('./editDiffLayout.svelte')).editDiffLayout;
    for (const layout of ['side-by-side', 'inline'] as const) {
      store.setPreference(layout);
      vi.resetModules();
      store = (await import('./editDiffLayout.svelte')).editDiffLayout;
      expect(store.preference).toBe(layout);
    }
  });
});
