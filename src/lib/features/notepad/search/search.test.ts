import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

describe('notepad search IPC payloads', () => {
  beforeEach(() => {
    invokeMock.mockReset();
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

  it('still sends current markdown for active search results', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const { searchNotes } = await import('./search');

    await searchNotes('atlas', 'all', {
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: 'large unsaved body'
    });

    expect(invokeMock).toHaveBeenCalledWith('search_notes_hybrid', {
      query: 'atlas',
      mode: 'all',
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: 'large unsaved body',
      limit: 12
    });
  });
});
