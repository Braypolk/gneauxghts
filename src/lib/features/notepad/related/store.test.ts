import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRelatedNotesStore } from './store.svelte';
import { EMPTY_RELATED_REASON } from './layout';
import type { RelatedNotesResponse } from '$lib/types/semantic';

const { getRelatedNotesMock } = vi.hoisted(() => ({ getRelatedNotesMock: vi.fn() }));
vi.mock('$lib/features/notepad/search/search', () => ({ getRelatedNotes: getRelatedNotesMock }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function response(noteTitle: string, scope: 'note' | 'selection' = 'note'): RelatedNotesResponse {
  return {
    items: [{ noteId: noteTitle, notePath: `/vault/${noteTitle}.md`, noteTitle,
      sectionLabel: '', excerpt: '', matchText: '', score: 1, startLine: 1, endLine: 1 }],
    status: 'ready', reason: null, scope
  };
}

function harness() {
  let markdown = 'large unsaved body';
  const getCurrentMarkdown = vi.fn(() => markdown);
  const related = createRelatedNotesStore({
    getCurrentPath: () => '/vault/current.md', getCurrentTitle: () => 'Current', getCurrentMarkdown
  });
  return { related, getCurrentMarkdown, setMarkdown(value: string) { markdown = value; } };
}

function visibleState(related: ReturnType<typeof createRelatedNotesStore>) {
  return { items: related.items, status: related.status, reason: related.reason, isLoading: related.isLoading };
}

function settle(pending: ReturnType<typeof deferred<RelatedNotesResponse>>, outcome: 'success' | 'error') {
  if (outcome === 'success') pending.resolve(response('Obsolete'));
  else pending.reject(new Error('obsolete retrieval failed'));
}

describe('related notes scheduling and response admission', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, getSelection: () => null
    });
    getRelatedNotesMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not read current markdown while the panel is collapsed', () => {
    const { related, getCurrentMarkdown } = harness();
    related.scheduleRelated({ immediate: true });
    expect(getCurrentMarkdown).not.toHaveBeenCalled();
    expect(getRelatedNotesMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defers current markdown reads until the related timer fires', async () => {
    const { related, getCurrentMarkdown } = harness();
    getRelatedNotesMock.mockResolvedValue(response('Current'));
    related.toggleRelatedPanel(null);
    expect(getCurrentMarkdown).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(219);
    expect(getCurrentMarkdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getCurrentMarkdown).toHaveBeenCalledTimes(1);
    expect(getRelatedNotesMock).toHaveBeenCalledWith({
      currentPath: '/vault/current.md', currentTitle: 'Current', currentMarkdown: 'large unsaved body'
    }, null, 4);
    expect(visibleState(related)).toEqual({
      items: response('Current').items, status: 'ready', reason: null, isLoading: false
    });
  });

  it.each(['success', 'error'] as const)(
    'ignores old %s while a replacement assessment waits', async (outcome) => {
      const { related, getCurrentMarkdown, setMarkdown } = harness();
      const pending = deferred<RelatedNotesResponse>();
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      related.isPanelCollapsed = false;
      related.items = response('Retained').items;
      related.status = 'ready';
      related.reason = null;
      getRelatedNotesMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response('Latest'));
      const oldRequest = related.runRelatedNotes();
      setMarkdown('replacement body');
      getCurrentMarkdown.mockClear();
      related.scheduleRelated({ immediate: true });
      const before = visibleState(related);
      settle(pending, outcome);
      await oldRequest;
      await vi.advanceTimersByTimeAsync(219);
      expect(visibleState(related)).toEqual(before);
      expect(getCurrentMarkdown).not.toHaveBeenCalled();
      expect(getRelatedNotesMock).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(getRelatedNotesMock).toHaveBeenLastCalledWith(expect.objectContaining({ currentMarkdown: 'replacement body' }), null, 4);
      expect(related.items).toEqual(response('Latest').items);
      expect(related.isLoading).toBe(false);
    }
  );

  it('retires the old note response while a selection assessment waits', async () => {
    const { related, getCurrentMarkdown } = harness();
    const pending = deferred<RelatedNotesResponse>();
    related.isPanelCollapsed = false;
    getRelatedNotesMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response('Selection', 'selection'));
    const oldRequest = related.runRelatedNotes();
    related.selectedText = 'Selected text long enough to use for a related retrieval request.';
    related.handleRelatedScopeChange('selection');
    getCurrentMarkdown.mockClear();
    const before = visibleState(related);
    pending.resolve(response('Obsolete'));
    await oldRequest;
    await vi.advanceTimersByTimeAsync(179);
    expect(visibleState(related)).toEqual(before);
    expect(getCurrentMarkdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getRelatedNotesMock).toHaveBeenLastCalledWith(expect.anything(), related.selectedText, 4);
    expect(related.items).toEqual(response('Selection', 'selection').items);
  });

  it.each(['empty note', 'empty selection'] as const)(
    'keeps %s reset authoritative after an old response arrives', async (action) => {
      const { related, setMarkdown } = harness();
      const pending = deferred<RelatedNotesResponse>();
      related.isPanelCollapsed = false;
      getRelatedNotesMock.mockReturnValueOnce(pending.promise);
      const oldRequest = related.runRelatedNotes();
      if (action === 'empty note') setMarkdown('');
      else related.scope = 'selection';
      await related.runRelatedNotes();
      pending.resolve(response('Obsolete'));
      await oldRequest;
      expect(visibleState(related)).toEqual({
        items: [], status: 'insufficientContent', reason: EMPTY_RELATED_REASON, isLoading: false
      });
    }
  );

  it('reset cancels a scheduled assessment without reading markdown', async () => {
    const { related, getCurrentMarkdown } = harness();
    related.toggleRelatedPanel(null);
    related.resetRelatedResults();
    await vi.advanceTimersByTimeAsync(220);
    expect(vi.getTimerCount()).toBe(0);
    expect(getCurrentMarkdown).not.toHaveBeenCalled();
    expect(getRelatedNotesMock).not.toHaveBeenCalled();
  });

  it.each(['collapse', 'dispose', 'clear selection'] as const)(
    'retires the in-flight response on %s', async (action) => {
      const { related } = harness();
      const pending = deferred<RelatedNotesResponse>();
      related.isPanelCollapsed = false;
      related.scope = 'selection';
      related.selectedText = 'Selected context';
      getRelatedNotesMock.mockReturnValueOnce(pending.promise);
      const oldRequest = related.runRelatedNotes();
      if (action === 'collapse') related.collapseRelatedPanel(null);
      else if (action === 'dispose') related.dispose();
      else related.clearSelectedRelatedText();
      const before = visibleState(related);
      pending.resolve(response('Obsolete'));
      await oldRequest;
      expect(visibleState(related)).toEqual(before);
      expect(related.isLoading).toBe(false);
    }
  );
});
