import { describe, expect, it, vi } from 'vitest';
import { createNoteDraftState } from '#lib/features/notepad/state/noteStore.js';
import {
  applySessionSnapshotToDocument,
  updateDocumentMarkdown
} from '#lib/features/notepad/document/documentState.js';
import { captureExternalSnapshotForTest } from '#lib/features/notepad/document/documentExternalSyncTestSupport.js';
import { createEmptySessionSnapshot } from '#lib/features/notepad/session/session.js';
import { createWorkspacePersistenceService } from './workspacePersistenceService';
import { createNotepadComposition, deferred } from '../orchestration/notepadCompositionTestSupport';

describe('workspacePersistenceService', () => {
  it('leaves a backgrounded capture blank and names it at the application navigation barrier', async () => {
    const f = createNotepadComposition({ ...createEmptySessionSnapshot(), bodyMarkdown: 'Keep a small garden journal while we travel next summer' });
    f.save.mockImplementation(async (title, markdown) => ({ title, markdown, noteId: 'capture',
      path: `/vault/${title || 'Untitled Note capture'}.md` }));
    const service = createWorkspacePersistenceService({ getDocuments: () => [f.initialDocument],
      flushAllPaneCursorSaves: vi.fn(), cancelPendingAutosave: f.persistence.cancelPendingAutosave,
      enqueueSave: f.persistence.enqueueSave, prepareDocumentForDeparture: f.editing.finalizeTitleOnDeparture });
    try {
      await service.flushAllForBackground();
      expect(f.initialDocument.working.title).toBe('');
      await service.flushAllForNavigation();
      expect(f.initialDocument.working.title).toBe('Keep a small garden journal while we travel');
      expect(f.initialDocument.identity).toMatchObject({ noteId: 'capture', path: '/vault/Keep a small garden journal while we travel.md' });
      expect(f.save).toHaveBeenCalledTimes(2);
    } finally { await f.dispose(); }
  });

  it.each([
    { edits: ['Temporary title', ''], expected: 'First-line fallback' },
    { edits: ['   '], expected: 'First-line fallback' },
    { edits: ['', 'My chosen title'], expected: 'My chosen title' }
  ])('settles the latest title edits $edits during application navigation', async ({ edits, expected }) => {
    const body = 'First-line fallback';
    const f = createNotepadComposition({ ...createEmptySessionSnapshot(), bodyMarkdown: body });
    const entered = deferred<void>();
    const held = deferred<void>();
    f.save.mockImplementation(async (title, markdown) => {
      if (f.save.mock.calls.length === 1) { entered.resolve(); await held.promise; }
      return { noteId: 'capture', path: `/vault/${title || 'Untitled Note capture'}.md`, title, markdown };
    });
    const service = createWorkspacePersistenceService({ getDocuments: () => [f.initialDocument],
      flushAllPaneCursorSaves: vi.fn(), cancelPendingAutosave: f.persistence.cancelPendingAutosave,
      enqueueSave: f.persistence.enqueueSave, prepareDocumentForDeparture: f.editing.finalizeTitleOnDeparture });
    try {
      const departure = service.flushAllForNavigation();
      await entered.promise;
      for (const title of edits) f.editing.updateTitle(f.initialDocument, title);
      held.resolve();
      await departure;
      expect(f.initialDocument.working.title).toBe(expected);
      expect(f.initialDocument.savedBaseline?.content.title).toBe(expected);
      expect(f.initialDocument.savedBaseline?.content.body.toMarkdown()).toBe(body);
      expect(f.initialDocument.identity).toMatchObject({ noteId: 'capture', path: `/vault/${expected}.md` });
    } finally { held.resolve(); await f.dispose(); }
  });

  it.each(['flushAllForNavigation', 'flushAllForBackground'] as const)('settles recovery work before completing %s without changing canonical outcome', async operation => {
    let release!: () => void;
    const recovery = new Promise<void>(resolve => { release = resolve; });
    const complete = vi.fn();
    const service = createWorkspacePersistenceService({ getDocuments: () => [], flushAllPaneCursorSaves: vi.fn(),
      cancelPendingAutosave: vi.fn(), enqueueSave: vi.fn(), flushRecoveryCopies: () => recovery });
    const pending = service[operation]().then(complete);
    await Promise.resolve(); expect(complete).not.toHaveBeenCalled(); release(); await pending; expect(complete).toHaveBeenCalledOnce();
  });

  it('a recovery failure does not replace the canonical save failure', async () => {
    const document = createNoteDraftState(); updateDocumentMarkdown(document, 'unsaved');
    const service = createWorkspacePersistenceService({ getDocuments: () => [document], flushAllPaneCursorSaves: vi.fn(),
      cancelPendingAutosave: vi.fn(), enqueueSave: async () => { throw new Error('Canonical failure'); },
      flushRecoveryCopies: async () => { throw new Error('Recovery failure'); } });
    await expect(service.flushAllForNavigation()).rejects.toThrow('Canonical failure');
  });
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
