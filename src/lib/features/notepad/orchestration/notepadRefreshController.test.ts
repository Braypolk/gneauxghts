import { describe, expect, it, vi } from 'vitest';
import { createNotepadRefreshController } from './notepadRefreshController';

describe('notepad refresh controller', () => {
  it('ignores classified chat projection changes', async () => {
    const refreshCurrentNoteIfChanged = vi.fn(async () => undefined);
    const refreshDerivedViews = vi.fn(async () => undefined);
    const refreshCurrentNoteFromTaskMutation = vi.fn(async () => undefined);
    const replaceNoteAcrossPanes = vi.fn(async () => undefined);
    const controller = createNotepadRefreshController({
      getDocumentSession: () =>
        ({ currentNotePath: '/vault/note.md' }) as never,
      refreshDerivedViews,
      updateRelatedDrawerLayout: vi.fn(),
      refreshCurrentNoteIfChanged,
      refreshCurrentNoteFromTaskMutation,
      getNoteByKey: vi.fn(() => null),
      getPaneIdsForDocument: vi.fn(() => []),
      replaceNoteAcrossPanes,
      replaceReferencedNoteWithFreshDraft: vi.fn(),
      noteKeyFromPath: vi.fn(() => null)
    });

    await controller.handleVaultNoteChanged({
      notePath: '/vault/Chats/example/Part 001.md',
      deleted: false,
      documentKind: 'chatTranscript',
      source: 'external'
    });

    expect(refreshCurrentNoteIfChanged).not.toHaveBeenCalled();
    expect(refreshCurrentNoteFromTaskMutation).not.toHaveBeenCalled();
    expect(refreshDerivedViews).not.toHaveBeenCalled();
    expect(replaceNoteAcrossPanes).not.toHaveBeenCalled();
  });
});
