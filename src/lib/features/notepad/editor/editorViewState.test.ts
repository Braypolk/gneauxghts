import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEditorViewState, saveEditorViewState } from './editorViewState';

const STORAGE_KEY = 'gneauxghts:notepad-cursors:v1';

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seed(entries: Record<string, unknown>) {
  storage.set(STORAGE_KEY, JSON.stringify(entries));
}

describe('editor view state', () => {
  it('round-trips the selection and scroll offset for a pane', () => {
    saveEditorViewState(
      '/vault/Note.md',
      { anchor: 40, head: 52, scrollTop: 1200 },
      'pane-1',
      'note-1'
    );

    expect(loadEditorViewState('/vault/Note.md', 'pane-1', 'note-1')).toEqual({
      anchor: 40,
      head: 52,
      scrollTop: 1200
    });
  });

  it('reads entries saved before scroll was tracked without a scroll offset', () => {
    seed({
      'pane-1::/vault/Note.md': { anchor: 8, head: 8, updatedAtMillis: 1 }
    });

    expect(loadEditorViewState('/vault/Note.md', 'pane-1')).toEqual({
      anchor: 8,
      head: 8
    });
  });

  it('ignores a corrupt scroll offset rather than dropping the cursor', () => {
    seed({
      'pane-1::/vault/Note.md': {
        anchor: 8,
        head: 8,
        scrollTop: Number.NaN,
        updatedAtMillis: 1
      }
    });

    expect(loadEditorViewState('/vault/Note.md', 'pane-1')).toEqual({
      anchor: 8,
      head: 8
    });
  });

  it('clamps a negative scroll offset on the way in', () => {
    saveEditorViewState('/vault/Note.md', { anchor: 0, head: 0, scrollTop: -40 }, 'pane-1');

    expect(loadEditorViewState('/vault/Note.md', 'pane-1')).toEqual({
      anchor: 0,
      head: 0,
      scrollTop: 0
    });
  });

  it('falls back to the note id when the note has been moved on disk', () => {
    saveEditorViewState(
      '/vault/Old.md',
      { anchor: 4, head: 4, scrollTop: 90 },
      'pane-1',
      'note-1'
    );

    expect(loadEditorViewState('/vault/New.md', 'pane-1', 'note-1')).toEqual({
      anchor: 4,
      head: 4,
      scrollTop: 90
    });
  });

  it('reuses another pane\'s position when this pane has never shown the note', () => {
    saveEditorViewState(
      '/vault/Note.md',
      { anchor: 7, head: 7, scrollTop: 300 },
      'pane-1'
    );

    expect(loadEditorViewState('/vault/Note.md', 'pane-2')).toEqual({
      anchor: 7,
      head: 7,
      scrollTop: 300
    });
  });

  it('returns nothing for a note that has never been opened', () => {
    expect(loadEditorViewState('/vault/Unseen.md', 'pane-1')).toBeNull();
  });
});
