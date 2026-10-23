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

it('passes an edited-time cue to native ranking while preserving draft acknowledgement', async () => {
  const { searchNotes } = await import('./search');
  invokeMock.mockResolvedValue([]);
  await searchNotes('idea', {
    currentPath: '/vault/current.md', currentTitle: 'Current', currentMarkdown: 'body'
  }, { modifiedSinceMillis: 1234 });
  expect(invokeMock).toHaveBeenCalledWith('search_notes_hybrid', expect.objectContaining({
    query: 'idea', modifiedSinceMillis: 1234, currentMarkdown: 'body',
    currentBodyHash: computeDraftHash('body')
  }));
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
