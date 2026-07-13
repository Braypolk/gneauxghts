import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

describe('notepad search IPC payloads', () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    const { forgetDraft } = await import('./draftRef');
    forgetDraft('/vault/current.md');
    forgetDraft(null);
  });

  it('does not send current markdown for recent note loading', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const { listRecentNotes } = await import('./search');

    await listRecentNotes({
      currentPath: '/vault/current.md'
    });

    expect(invokeMock).toHaveBeenCalledWith('list_recent_notes', {
      limit: 20,
      currentPath: '/vault/current.md'
    });
  });

  it('sends current markdown plus hash on the first search request', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const { searchNotes } = await import('./search');
    const { computeDraftHash } = await import('./draftRef');
    const body = 'large unsaved body';

    await searchNotes('atlas', 'all', {
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: body
    });

    expect(invokeMock).toHaveBeenCalledWith('search_notes_hybrid', {
      query: 'atlas',
      mode: 'all',
      scope: 'notes',
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: body,
      currentBodyHash: computeDraftHash(body),
      limit: 12
    });
  });

  it('omits current markdown when the backend has already cached this hash', async () => {
    invokeMock.mockResolvedValue([]);
    const { searchNotes } = await import('./search');
    const { computeDraftHash } = await import('./draftRef');
    const body = 'large unsaved body';

    await searchNotes('atlas', 'all', {
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: body
    });
    invokeMock.mockClear();

    await searchNotes('atla', 'all', {
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: body
    });

    expect(invokeMock).toHaveBeenCalledWith('search_notes_hybrid', {
      query: 'atla',
      mode: 'all',
      scope: 'notes',
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: null,
      currentBodyHash: computeDraftHash(body),
      limit: 12
    });
  });

});
