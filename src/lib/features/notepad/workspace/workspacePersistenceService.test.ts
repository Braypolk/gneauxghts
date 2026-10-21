import { describe, expect, it, vi } from 'vitest';
import { createNoteDraftState } from '#lib/features/notepad/state/noteStore.js';
import {
  applySessionSnapshotToDocument,
  updateDocumentMarkdown
} from '#lib/features/notepad/document/documentState.js';
import { captureExternalSnapshotForTest } from '#lib/features/notepad/document/documentExternalSyncTestSupport.js';
import { createEmptySessionSnapshot } from '#lib/features/notepad/session/session.js';
import { createWorkspacePersistenceService } from './workspacePersistenceService';

describe('workspacePersistenceService', () => {
  it('background saves independent notes while retaining conflicts and failed edits', async () => {
    const failed = createNoteDraftState();
    const healthy = createNoteDraftState();
    const conflict = createNoteDraftState();
    for (const note of [failed, healthy, conflict]) updateDocumentMarkdown(note, 'keep these edits');
    captureExternalSnapshotForTest(conflict, { ...createEmptySessionSnapshot(), bodyMarkdown: 'external' }, 'watcher');
    const enqueueSave = vi.fn(async (note) => {
      if (note === failed) throw new Error('disk unavailable');
      applySessionSnapshotToDocument(note, {
        ...createEmptySessionSnapshot(), bodyMarkdown: note.working.body.toMarkdown(), lastSavedMarkdown: note.working.body.toMarkdown()
      });
    });
    const service = createWorkspacePersistenceService({
      flushAllPaneCursorSaves: vi.fn(), getDocuments: () => [failed, conflict, healthy],
      cancelPendingAutosave: vi.fn(), enqueueSave
    });

    await expect(service.flushAllForBackground()).rejects.toThrow();

    expect(enqueueSave.mock.calls.map(([note]) => note)).toEqual([failed, healthy]);
    expect(healthy.savedBaseline?.content.body.toMarkdown()).toBe('keep these edits');
    expect(failed.working.body.toMarkdown()).toBe('keep these edits');
    expect(failed.savedBaseline).toBeNull();
    expect(conflict.working.body.toMarkdown()).toBe('keep these edits');
  });


  it('flushes all ordinary edits at the navigation barrier', async () => {
    const left = createNoteDraftState();
    const right = createNoteDraftState();
    updateDocumentMarkdown(left, 'left');
    updateDocumentMarkdown(right, 'right');
    const flushAllPaneCursorSaves = vi.fn();
    const cancelPendingAutosave = vi.fn();
    const enqueueSave = vi.fn(async (document) => {
      applySessionSnapshotToDocument(document, {
        ...createEmptySessionSnapshot(),
        bodyMarkdown: document.working.body.toMarkdown(),
        lastSavedMarkdown: document.working.body.toMarkdown()
      });
    });
    const service = createWorkspacePersistenceService({
      flushAllPaneCursorSaves,
      getDocuments: () => [left, right],
      cancelPendingAutosave,
      enqueueSave
    });

    await service.flushAllForNavigation();

    expect(flushAllPaneCursorSaves).toHaveBeenCalledOnce();
    expect(cancelPendingAutosave).toHaveBeenCalledTimes(2);
    expect(cancelPendingAutosave).toHaveBeenNthCalledWith(1, left);
    expect(cancelPendingAutosave).toHaveBeenNthCalledWith(2, right);
    expect(enqueueSave).toHaveBeenCalledTimes(2);
    expect(enqueueSave).toHaveBeenNthCalledWith(1, left);
    expect(enqueueSave).toHaveBeenNthCalledWith(2, right);
  });

  it('retries a document changed during its first save before allowing navigation', async () => {
    const note = createNoteDraftState();
    updateDocumentMarkdown(note, 'first');
    const enqueueSave = vi.fn(async (document) => {
      if (enqueueSave.mock.calls.length === 1) {
        updateDocumentMarkdown(document, 'second');
        applySessionSnapshotToDocument(
          document,
          {
            ...createEmptySessionSnapshot(),
            bodyMarkdown: 'first',
            lastSavedMarkdown: 'first'
          },
          { preserveWorking: true }
        );
        return;
      }
      applySessionSnapshotToDocument(document, {
        ...createEmptySessionSnapshot(),
        bodyMarkdown: 'second',
        lastSavedMarkdown: 'second'
      });
    });
    const service = createWorkspacePersistenceService({
      flushAllPaneCursorSaves: vi.fn(),
      getDocuments: () => [note],
      cancelPendingAutosave: vi.fn(),
      enqueueSave
    });

    await service.flushAllForNavigation();

    expect(enqueueSave).toHaveBeenCalledTimes(2);
  });

  it('blocks navigation while an external conflict is unresolved', async () => {
    const note = createNoteDraftState();
    updateDocumentMarkdown(note, 'local');
    captureExternalSnapshotForTest(
      note,
      {
        ...createEmptySessionSnapshot(),
        bodyMarkdown: 'external'
      },
      'watcher'
    );
    const enqueueSave = vi.fn(async () => undefined);
    const service = createWorkspacePersistenceService({
      flushAllPaneCursorSaves: vi.fn(),
      getDocuments: () => [note],
      cancelPendingAutosave: vi.fn(),
      enqueueSave
    });

    await expect(
      service.flushAllForNavigation()
    ).rejects.toThrow('Resolve the note’s external-change conflict');
    expect(enqueueSave).not.toHaveBeenCalled();
  });
});
