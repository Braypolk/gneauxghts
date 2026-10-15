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
  it('background saves independent notes while retaining conflicts, reviews and failed edits', async () => {
    const failed = createNoteDraftState();
    const healthy = createNoteDraftState();
    const conflict = createNoteDraftState();
    const review = createNoteDraftState();
    for (const note of [failed, healthy, conflict, review]) updateDocumentMarkdown(note, 'keep these edits');
    captureExternalSnapshotForTest(conflict, { ...createEmptySessionSnapshot(), bodyMarkdown: 'external' }, 'watcher');
    const enqueueSave = vi.fn(async (note) => {
      if (note === failed) throw new Error('disk unavailable');
      applySessionSnapshotToDocument(note, {
        ...createEmptySessionSnapshot(), bodyMarkdown: note.working.markdown, lastSavedMarkdown: note.working.markdown
      });
    });
    const service = createWorkspacePersistenceService({
      flushReviews: async () => { throw new Error('review checkpoint unavailable'); },
      flushAllPaneCursorSaves: vi.fn(), getDocuments: () => [failed, conflict, review, healthy],
      cancelPendingAutosave: vi.fn(), enqueueSave, isReviewingDocument: note => note === review
    });

    await expect(service.flushAllForBackground()).rejects.toThrow();

    expect(enqueueSave.mock.calls.map(([note]) => note)).toEqual([failed, healthy]);
    expect(healthy.savedBaseline?.content.markdown).toBe('keep these edits');
    expect(failed.working.markdown).toBe('keep these edits');
    expect(failed.savedBaseline).toBeNull();
    expect(review.savedBaseline).toBeNull();
    expect(conflict.working.markdown).toBe('keep these edits');
  });

  it('saves ordinary notes before reporting a failed navigation review checkpoint', async () => {
    const note = createNoteDraftState();
    const review = createNoteDraftState();
    updateDocumentMarkdown(note, 'ordinary edits');
    updateDocumentMarkdown(review, 'pending review');
    const service = createWorkspacePersistenceService({
      flushReviews: async () => { throw new Error('review checkpoint unavailable'); },
      flushAllPaneCursorSaves: vi.fn(),
      getDocuments: () => [review, note],
      cancelPendingAutosave: vi.fn(),
      isReviewingDocument: document => document === review,
      enqueueSave: async document => {
        await Promise.resolve();
        applySessionSnapshotToDocument(document, {
          ...createEmptySessionSnapshot(),
          bodyMarkdown: document.working.markdown,
          lastSavedMarkdown: document.working.markdown
        });
      }
    });
    await expect(service.flushAllForNavigation()).rejects.toThrow('review checkpoint unavailable');
    expect(note.savedBaseline?.content.markdown).toBe('ordinary edits');
    expect(review.savedBaseline).toBeNull();
  });

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
