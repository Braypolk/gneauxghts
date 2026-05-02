import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

describe('wikilink IPC payloads', () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    const { forgetDraft } = await import('$lib/features/notepad/search/draftRef');
    forgetDraft('/vault/current.md');
    forgetDraft(null);
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
      currentBodyHash: null,
      limit: 8
    });
  });

  it('sends current markdown for same-note section autocomplete on first call', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const { autocompleteNoteLinks } = await import('./state');
    const { computeDraftHash } = await import('$lib/features/notepad/search/draftRef');
    const body = 'large unsaved body';

    await autocompleteNoteLinks('#Heading', '/vault/current.md', 'Current', body);

    expect(invokeMock).toHaveBeenCalledWith('autocomplete_note_links', {
      rawTarget: '#Heading',
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: body,
      currentBodyHash: computeDraftHash(body),
      limit: 8
    });
  });

  it('omits markdown for section autocomplete after the backend has cached the hash', async () => {
    invokeMock.mockResolvedValue([]);
    const { autocompleteNoteLinks } = await import('./state');
    const { computeDraftHash } = await import('$lib/features/notepad/search/draftRef');
    const body = 'large unsaved body';

    await autocompleteNoteLinks('#Heading', '/vault/current.md', 'Current', body);
    invokeMock.mockClear();
    await autocompleteNoteLinks('#Other', '/vault/current.md', 'Current', body);

    expect(invokeMock).toHaveBeenCalledWith('autocomplete_note_links', {
      rawTarget: '#Other',
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: null,
      currentBodyHash: computeDraftHash(body),
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
      currentMarkdown: null,
      currentBodyHash: null
    });
  });
});
