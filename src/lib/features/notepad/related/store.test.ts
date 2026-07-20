import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRelatedNotesStore } from './store.svelte';

const { getRelatedNotesMock } = vi.hoisted(() => ({
  getRelatedNotesMock: vi.fn()
}));

vi.mock('$lib/features/notepad/search/search', () => ({
  getRelatedNotes: getRelatedNotesMock
}));

describe('related notes scheduling', () => {
  let scheduledRelatedCallback: (() => void) | null = null;
  const setTimeoutMock = vi.fn((callback: () => void) => {
    scheduledRelatedCallback = callback;
    return 1;
  });
  const clearTimeoutMock = vi.fn();

  beforeEach(() => {
    scheduledRelatedCallback = null;
    setTimeoutMock.mockClear();
    clearTimeoutMock.mockClear();
    vi.stubGlobal('window', {
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock,
      getSelection: () => null
    });
    getRelatedNotesMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not read current markdown while the panel is collapsed', () => {
    const getCurrentMarkdown = vi.fn(() => 'large unsaved body');
    const related = createRelatedNotesStore({
      getCurrentPath: () => '/vault/current.md',
      getCurrentTitle: () => 'Current',
      getCurrentMarkdown
    });

    related.scheduleRelated({ immediate: true });

    expect(getCurrentMarkdown).not.toHaveBeenCalled();
    expect(getRelatedNotesMock).not.toHaveBeenCalled();
    expect(setTimeoutMock).not.toHaveBeenCalled();
  });

  it('defers current markdown reads until the related timer fires', () => {
    const getCurrentMarkdown = vi.fn(() => 'large unsaved body');
    getRelatedNotesMock.mockResolvedValue({
      items: [],
      status: 'ready',
      reason: null
    });
    const related = createRelatedNotesStore({
      getCurrentPath: () => '/vault/current.md',
      getCurrentTitle: () => 'Current',
      getCurrentMarkdown
    });

    related.toggleRelatedPanel(null);

    expect(getCurrentMarkdown).not.toHaveBeenCalled();
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);

    scheduledRelatedCallback?.();


    expect(getCurrentMarkdown).toHaveBeenCalledTimes(1);
    expect(getRelatedNotesMock).toHaveBeenCalledWith(
      {
        currentPath: '/vault/current.md',
        currentTitle: 'Current',
        currentMarkdown: 'large unsaved body'
      },
      null,
      4
    );
  });
});
