import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

describe('wikilink IPC payloads', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('does not send current markdown for note-only autocomplete', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const { autocompleteNoteLinks } = await import('./state');

    await autocompleteNoteLinks('Project', '/vault/current.md', 'Current', 'large unsaved body');

    expect(invokeMock).toHaveBeenCalledWith('autocomplete_note_links', {
      rawTarget: 'Project',
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: null,
      limit: 8
    });
  });

  it('sends current markdown for same-note section autocomplete', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const { autocompleteNoteLinks } = await import('./state');

    await autocompleteNoteLinks('#Heading', '/vault/current.md', 'Current', 'large unsaved body');

    expect(invokeMock).toHaveBeenCalledWith('autocomplete_note_links', {
      rawTarget: '#Heading',
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: 'large unsaved body',
      limit: 8
    });
  });

  it('does not send current markdown for note-only resolution', async () => {
    invokeMock.mockResolvedValueOnce(null);
    const { resolveNoteLink } = await import('./state');

    await resolveNoteLink('Project', '/vault/current.md', 'Current', 'large unsaved body');

    expect(invokeMock).toHaveBeenCalledWith('resolve_note_link', {
      rawTarget: 'Project',
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: null
    });
  });
});
