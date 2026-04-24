import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotepadPersistenceController } from './persistenceController';
import { createNoteDraftState, type NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { SessionSnapshot } from '$lib/features/notepad/session/session';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    title: 'Saved',
    bodyMarkdown: 'saved body',
    currentNoteId: 'note-id',
    currentNotePath: '/vault/Saved.md',
    lastSavedTitle: 'Saved',
    lastSavedMarkdown: 'saved body',
    lastSavedNoteId: 'note-id',
    lastSavedPath: '/vault/Saved.md',
    ...overrides
  };
}

function dirtyNote(): NoteDraftState {
  return createNoteDraftState({
    ...snapshot(),
    title: 'Draft',
    bodyMarkdown: 'draft body'
  });
}

describe('persistenceController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('schedules autosave through the note queue and clears clean buffers', async () => {
    const note = dirtyNote();
    const saveNoteSession = vi.fn().mockResolvedValue(
      snapshot({
        title: 'Draft',
        bodyMarkdown: 'draft body',
        lastSavedTitle: 'Draft',
        lastSavedMarkdown: 'draft body'
      })
    );
    const scheduleAutoSync = vi.fn();
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      timers: new Map(),
      queues: new Map(),
      saveNoteSession,
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      scheduleAutoSync
    });

    controller.scheduleAutosave(note);
    await vi.advanceTimersByTimeAsync(1000);
    await controller.getNoteSaveQueue(note.key);

    expect(saveNoteSession).toHaveBeenCalledWith('Draft', 'draft body', '/vault/Saved.md');
    expect(note.status).toBe('idle');
    expect(controller.hasCleanBuffer(note)).toBe(true);
    expect(scheduleAutoSync).toHaveBeenCalledWith('note-saved', 600);
  });

  it('does not apply stale save results after a note revision changes', async () => {
    const note = dirtyNote();
    let resolveSave!: (snapshot: SessionSnapshot) => void;
    const savePromise = new Promise<SessionSnapshot>((resolve) => {
      resolveSave = resolve;
    });
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      timers: new Map(),
      queues: new Map(),
      saveNoteSession: vi.fn().mockReturnValue(savePromise),
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      scheduleAutoSync: vi.fn()
    });

    const save = controller.enqueueSave(note);
    await vi.waitFor(() => expect(note.status).toBe('saving'));
    note.title = 'Newer draft';
    note.operationRevision += 1;
    resolveSave(
      snapshot({
        title: 'Draft',
        bodyMarkdown: 'draft body',
        lastSavedTitle: 'Draft',
        lastSavedMarkdown: 'draft body'
      })
    );
    await save;

    expect(note.title).toBe('Newer draft');
    expect(note.status).toBe('saving');
  });
});
