import { describe, expect, it, vi } from 'vitest';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  applySessionSnapshotToDocument,
  updateDocumentMarkdown
} from '$lib/features/notepad/document/documentState';
import { captureExternalSnapshotForTest } from '$lib/features/notepad/document/documentExternalSyncTestSupport';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createWorkspacePersistenceService } from './workspacePersistenceService';

describe('workspacePersistenceService', () => {
  it('flushes ordinary edits while retaining a pending proposal at the navigation barrier', async () => {
    const left = createNoteDraftState();
    const right = createNoteDraftState();
    const review = createNoteDraftState();
    updateDocumentMarkdown(left, 'left');
    updateDocumentMarkdown(right, 'right');
    updateDocumentMarkdown(review, 'unaccepted proposal');
    const flushAllPaneCursorSaves = vi.fn();
    const cancelPendingAutosave = vi.fn();
    const enqueueSave = vi.fn(async (document) => {
      applySessionSnapshotToDocument(document, {
        ...createEmptySessionSnapshot(),
        bodyMarkdown: document.working.markdown,
        lastSavedMarkdown: document.working.markdown
      });
    });
    const service = createWorkspacePersistenceService({
      flushAllPaneCursorSaves,
      getDocuments: () => [left, review, right],
      cancelPendingAutosave,
      enqueueSave,
      isReviewingDocument: (document) => document === review
    });

    await service.flushAllForNavigation();

    expect(flushAllPaneCursorSaves).toHaveBeenCalledOnce();
    expect(cancelPendingAutosave).toHaveBeenCalledTimes(3);
    expect(cancelPendingAutosave).toHaveBeenNthCalledWith(1, left);
    expect(cancelPendingAutosave).toHaveBeenNthCalledWith(2, review);
    expect(cancelPendingAutosave).toHaveBeenNthCalledWith(3, right);
    expect(enqueueSave).toHaveBeenCalledTimes(2);
    expect(enqueueSave).toHaveBeenNthCalledWith(1, left);
    expect(enqueueSave).toHaveBeenNthCalledWith(2, right);
    expect(review.working.markdown).toBe('unaccepted proposal');
    expect(review.savedBaseline).toBeNull();
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
