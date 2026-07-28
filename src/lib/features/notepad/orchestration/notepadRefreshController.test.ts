import { describe, expect, it, vi } from 'vitest';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  createNoteDraftState
} from '$lib/features/notepad/state/noteStore';
import {
  updateDocumentMarkdown
} from '$lib/features/notepad/document/documentState';
import { createNotepadRefreshController } from './notepadRefreshController';

const path = '/vault/note.md';

function persistedNote() {
  return createNoteDraftState({
    ...createEmptySessionSnapshot(),
    title: 'Note',
    bodyMarkdown: 'saved',
    currentNoteId: 'note-id',
    currentNotePath: path,
    lastSavedTitle: 'Note',
    lastSavedMarkdown: 'saved',
    lastSavedNoteId: 'note-id',
    lastSavedPath: path
  });
}

function setup() {
  const note = persistedNote();
  const freshDraft = createNoteDraftState();
  const refreshDerivedViews = vi.fn(async () => undefined);
  const refreshDocumentFromDisk = vi.fn(
    async () => undefined
  );
  const replaceNoteAcrossPanes = vi.fn(
    async () => undefined
  );
  const suspendPersistenceForConflict = vi.fn();
  const getPaneIdsForDocument = vi.fn(() => [
    'notepad-pane-1',
    'notepad-pane-2'
  ] as never);
  const controller = createNotepadRefreshController({
    getDocumentSession: () => note,
    refreshDerivedViews,
    updateRelatedDrawerLayout: vi.fn(),
    refreshDocumentFromDisk,
    getNoteByKey: vi.fn(() => note),
    getPaneIdsForDocument,
    replaceNoteAcrossPanes,
    replaceReferencedNoteWithFreshDraft: vi.fn(
      () => freshDraft
    ),
    suspendPersistenceForConflict,
    noteKeyFromPath: vi.fn(() => note.key)
  });
  return {
    note,
    freshDraft,
    controller,
    refreshDerivedViews,
    refreshDocumentFromDisk,
    replaceNoteAcrossPanes,
    getPaneIdsForDocument,
    suspendPersistenceForConflict
  };
}

describe('notepad refresh controller', () => {
  it('ignores classified chat projection changes', async () => {
    const harness = setup();

    await harness.controller.handleVaultNoteChanged({
      notePath: '/vault/Chats/example/Part 001.md',
      deleted: false,
      documentKind: 'chatTranscript',
      source: 'external'
    });

    expect(
      harness.refreshDocumentFromDisk
    ).not.toHaveBeenCalled();
    expect(
      harness.refreshDerivedViews
    ).not.toHaveBeenCalled();
    expect(
      harness.replaceNoteAcrossPanes
    ).not.toHaveBeenCalled();
    expect(
      harness.suspendPersistenceForConflict
    ).not.toHaveBeenCalled();
  });

  it('refreshes the shared loaded document once for every pane reference', async () => {
    const harness = setup();

    await harness.controller.handleVaultNoteChanged({
      notePath: path,
      deleted: false,
      source: 'external'
    });

    expect(harness.getPaneIdsForDocument).toHaveReturnedWith([
      'notepad-pane-1',
      'notepad-pane-2'
    ]);
    expect(
      harness.refreshDocumentFromDisk
    ).toHaveBeenCalledOnce();
    expect(
      harness.refreshDocumentFromDisk
    ).toHaveBeenCalledWith(harness.note, {
      source: 'watcher'
    });
  });

  it('routes task mutations through the same non-forcing refresh seam', async () => {
    const harness = setup();
    updateDocumentMarkdown(harness.note, 'local edit');

    await harness.controller.handleVaultNoteChanged({
      notePath: path,
      deleted: false,
      source: 'taskMutation'
    });

    expect(
      harness.refreshDocumentFromDisk
    ).toHaveBeenCalledWith(harness.note, {
      source: 'taskMutation'
    });
    expect(harness.note.working.markdown).toBe('local edit');
  });

  it('records external deletion as a recoverable conflict for a dirty shared document', async () => {
    const harness = setup();
    updateDocumentMarkdown(harness.note, 'local edit');

    await harness.controller.handleVaultNoteChanged({
      notePath: path,
      deleted: true,
      source: 'external'
    });

    expect(harness.note.externalSync).toEqual({
      kind: 'conflict',
      external: {
        kind: 'deletion',
        source: 'watcher',
        path
      }
    });
    expect(
      harness.replaceNoteAcrossPanes
    ).not.toHaveBeenCalled();
    expect(
      harness.suspendPersistenceForConflict
    ).toHaveBeenCalledWith(harness.note);
  });

  it('replaces all pane references with one fresh draft after a clean external deletion', async () => {
    const harness = setup();

    await harness.controller.handleVaultNoteChanged({
      notePath: path,
      deleted: true,
      source: 'external'
    });

    expect(
      harness.replaceNoteAcrossPanes
    ).toHaveBeenCalledWith(
      harness.note,
      harness.freshDraft
    );
  });
});
