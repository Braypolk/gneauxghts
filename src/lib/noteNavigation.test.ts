import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumePendingNoteTarget, storePendingNoteTarget } from './noteNavigation';

describe('noteNavigation', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores and consumes a pending note target once', () => {
    storePendingNoteTarget({ noteId: 'note-1', notePath: '/vault/Note.md' });

    expect(consumePendingNoteTarget()).toEqual({
      noteId: 'note-1',
      notePath: '/vault/Note.md'
    });
    expect(consumePendingNoteTarget()).toBeNull();
  });
});
