import { beforeEach, expect, it, vi } from 'vitest';
import { computeDraftHash, forgetDraft } from './draftRef';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
  invokeMock.mockReset();
  forgetDraft('/vault/current.md');
});

it('does not send current markdown for recent note loading', async () => {
  invokeMock.mockResolvedValueOnce([]);
  const { listRecentNotes } = await import('./search');
  await listRecentNotes({ currentPath: '/vault/current.md' });
  expect(invokeMock).toHaveBeenCalledWith('list_recent_notes', {
    limit: 20,
    currentPath: '/vault/current.md'
  });
});

it('preserves distinct search, related, and retrieval payloads with shared draft acknowledgement', async () => {
  const { searchNotes, getRelatedNotes, retrieveNoteContext } = await import('./search');
  const context = {
    currentPath: '/vault/current.md', currentTitle: 'Current',
    currentMarkdown: 'body', currentTags: ['tag']
  };
  invokeMock.mockResolvedValue({});
  await searchNotes('query', context);
  expect(invokeMock).toHaveBeenLastCalledWith('search_notes_hybrid', {
    query: 'query', currentPath: context.currentPath, currentTitle: 'Current',
    currentMarkdown: 'body', currentBodyHash: computeDraftHash('body'),
    currentTags: ['tag'], limit: 12
  });
  await getRelatedNotes(context, 'selected', 3);
  expect(invokeMock).toHaveBeenLastCalledWith('get_related_notes', {
    currentPath: context.currentPath, currentTitle: 'Current', currentMarkdown: null,
    currentBodyHash: computeDraftHash('body'), selectedText: 'selected', limit: 3
  });
  await retrieveNoteContext('query', context, { query: 'question', selectedText: 'selection', limit: 5 });
  expect(invokeMock).toHaveBeenLastCalledWith('retrieve_note_context', {
    scope: 'query', query: 'question', currentPath: context.currentPath,
    currentTitle: 'Current', currentMarkdown: null, currentBodyHash: computeDraftHash('body'),
    selectedText: 'selection', limit: 5
  });
});
