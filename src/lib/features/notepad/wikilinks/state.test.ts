import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

describe('wikilink IPC payloads', () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    const { forgetDraft } = await import('#lib/features/notepad/search/draftRef.js');
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
    const { computeDraftHash } = await import('#lib/features/notepad/search/draftRef.js');
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

it('retires visible suggestions while a new target is loading and ignores closed requests', async () => {
  const { createWikilinkAutocompleteState, beginWikilinkSuggestionRequest, completeWikilinkSuggestionRequest, dismissWikilinkAutocomplete, moveWikilinkSelection } = await import('./state');
  const active = { rawTarget: 'one', targetFrom: 2, targetTo: 5, left: 0, top: 0, bottom: 0 };
  const old = beginWikilinkSuggestionRequest(createWikilinkAutocompleteState(), active);
  const suggestions = [{ value: 'one', label: 'one', detail: '', kind: 'note' as const }];
  const visible = completeWikilinkSuggestionRequest(old.state, old.requestId, suggestions);
  expect(visible.active).toBe(true);
  const next = beginWikilinkSuggestionRequest(visible, { ...active, rawTarget: 'two' });
  expect(next.state).toMatchObject({ active: false, suggestions: [], selectedIndex: 0 });
  expect(completeWikilinkSuggestionRequest(next.state, old.requestId, suggestions)).toBe(next.state);
  const closed = dismissWikilinkAutocomplete(next.state);
  expect(completeWikilinkSuggestionRequest(closed, next.requestId, suggestions)).toBe(closed);
  const multiple = { ...visible, suggestions: [...suggestions, { ...suggestions[0], value: 'two' }] };
  expect(moveWikilinkSelection(multiple, -1).selectedIndex).toBe(1);
});
