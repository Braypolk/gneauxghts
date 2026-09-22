import { createWorkspacePersistenceService } from "$lib/features/notepad/workspace/workspacePersistenceService";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotepadPersistenceController } from "./persistenceController";
import {
  createNoteDraftState,
  type NoteDraftState,
} from "$lib/features/notepad/state/noteStore";
import type { SessionSnapshot } from "$lib/features/notepad/session/session";
import type { NoteSession } from "$lib/features/notepad/model/types";
import {
  getDocumentMarkdown,
  getDocumentNoteId,
  getDocumentPath,
  getDocumentStatusViewModel,
  getDocumentTitle,
  updateDocumentMarkdown,
} from "$lib/features/notepad/document/documentState";
import { captureExternalSnapshotForTest } from "$lib/features/notepad/document/documentExternalSyncTestSupport";
import { documentRegistry } from "$lib/features/notepad/document/documentRegistry";
import { createDocumentEditingService } from "$lib/features/notepad/document/documentEditingService";
import {
  bindNotepadStateToVault,
  createFreshDraftNote,
  createNotepadState
} from "$lib/features/notepad/state/noteStore";

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    title: "Saved",
    bodyMarkdown: "saved body",
    currentNoteId: "note-id",
    currentNotePath: "/vault/Saved.md",
    lastSavedTitle: "Saved",
    lastSavedMarkdown: "saved body",
    lastSavedNoteId: "note-id",
    lastSavedPath: "/vault/Saved.md",
    ...overrides,
  };
}

function dirtyNote(): NoteDraftState {
  return createNoteDraftState({
    ...snapshot(),
    title: "Draft",
    bodyMarkdown: "draft body",
  });
}

function committed(overrides: Partial<NoteSession> = {}): NoteSession {
  return {
    title: "Saved",
    markdown: "saved body",
    noteId: "note-id",
    path: "/vault/Saved.md",
    ...overrides,
  };
}

function committedSnapshot(
  overrides: Partial<SessionSnapshot> = {},
): NoteSession {
  const value = snapshot(overrides);
  return {
    title: value.title,
    markdown: value.bodyMarkdown,
    noteId: value.currentNoteId,
    path: value.currentNotePath,
    ...(value.commitWarning
      ? { commitWarning: value.commitWarning }
      : {}),
  };
}

function editingServiceForState(
  state: ReturnType<typeof createNotepadState>
) {
  return createDocumentEditingService({
    state,
    isApplyingProgrammaticUpdate: () => false,
    shouldSuppressAutosave: () => false,
    isTitleEditing: () => false,
    resetPaneCommandAfterBodyInput: vi.fn(),
    clearRecentlyForgotten: vi.fn(),
    clearSelectedRelatedText: vi.fn(),
    scheduleAutosave: vi.fn(),
    scheduleSearch: vi.fn(),
    scheduleRelated: vi.fn(),
  });
}

function editingServiceFor(note: NoteDraftState) {
  const state = createNotepadState(note);
  bindNotepadStateToVault(state, "/vault");
  return editingServiceForState(state);
}

describe("persistenceController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("saves tags and body in one existing note operation", async () => {
    const note = createNoteDraftState(snapshot({ tags: ['old'], lastSavedTags: ['old'] }));
    const editing = editingServiceFor(note);
    editing.updateTags(note, ['new']);
    const saveNoteSession = vi.fn().mockResolvedValue(committed({ tags: ['new'] }));
    const controller = createNotepadPersistenceController({ getDocumentSession: () => note, saveNoteSession, documentEditing: editing });
    await controller.enqueueSave(note);
    expect(saveNoteSession).toHaveBeenCalledExactlyOnceWith('Saved', 'saved body', '/vault/Saved.md', { previous: ['old'], tags: ['new'] });
    expect(controller.hasCleanBuffer(note)).toBe(true);
  });

  it("schedules autosave through the note queue and clears clean buffers", async () => {
    const note = dirtyNote();
    const saveNoteSession = vi.fn().mockResolvedValue(
      committedSnapshot({
        title: "Draft",
        bodyMarkdown: "draft body",
        lastSavedTitle: "Draft",
        lastSavedMarkdown: "draft body",
      }),
    );
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession,
      documentEditing: editingServiceFor(note),
    });

    controller.scheduleAutosave(note);
    await vi.advanceTimersByTimeAsync(1000);
    await controller.getNoteSaveQueue(note.handle);

    expect(saveNoteSession).toHaveBeenCalledWith(
      "Draft",
      "draft body",
      "/vault/Saved.md",
    );
    expect(note.operation.kind).toBe("idle");
    expect(controller.hasCleanBuffer(note)).toBe(true);
  });

  it("keeps task attribution on the exact revision when an editor save is already queued", async () => {
    const note = dirtyNote();
    const saveNoteSession = vi.fn();
    const saveTaskNoteSession = vi.fn().mockResolvedValue(
      committedSnapshot({
        title: "Draft",
        bodyMarkdown: "task body",
        lastSavedTitle: "Draft",
        lastSavedMarkdown: "task body",
      }),
    );
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession,
      saveTaskNoteSession,
      documentEditing: editingServiceFor(note),
    });
    let releaseBarrier!: () => void;
    const barrier = documentRegistry.ensure(note.handle).requestSave(
      () =>
        new Promise<void>((resolve) => {
          releaseBarrier = resolve;
        }),
    );
    const queuedEditorSave = controller.enqueueSave(note);

    controller.attributeTaskActionSave(note, "task body");
    updateDocumentMarkdown(note, "task body");
    const queuedTaskSave = controller.enqueueSave(note);
    releaseBarrier();
    await Promise.all([barrier, queuedEditorSave, queuedTaskSave]);

    expect(saveNoteSession).not.toHaveBeenCalled();
    expect(saveTaskNoteSession).toHaveBeenCalledWith(
      "Draft",
      "task body",
      "/vault/Saved.md",
    );
    expect(saveTaskNoteSession).toHaveBeenCalledTimes(1);
    expect(controller.hasCleanBuffer(note)).toBe(true);
  });

  it("does not apply save results after a deliberate invalidation", async () => {
    const note = dirtyNote();
    let resolveSave!: (snapshot: NoteSession) => void;
    const savePromise = new Promise<NoteSession>((resolve) => {
      resolveSave = resolve;
    });
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: vi.fn().mockReturnValue(savePromise),
      documentEditing: editingServiceFor(note),
    });

    const save = controller.enqueueSave(note);
    await vi.waitFor(() => expect(note.operation.kind).toBe("saving"));
    controller.invalidatePendingSaveResults(note);
    resolveSave(
      committedSnapshot({
        title: "Draft",
        bodyMarkdown: "draft body",
        lastSavedTitle: "Draft",
        lastSavedMarkdown: "draft body",
      }),
    );
    await save;

    expect(note.operation.kind).toBe("idle");
    expect(note.savedBaseline?.content.markdown).toBe("saved body");
  });

  it("adopts the persisted path while keeping a newer draft typed during the save", async () => {
    const note = createNoteDraftState({
      title: "",
      bodyMarkdown: "first line",
      currentNoteId: null,
      currentNotePath: null,
      lastSavedTitle: "",
      lastSavedMarkdown: "",
      lastSavedNoteId: null,
      lastSavedPath: null,
    });
    let resolveSave!: (snapshot: NoteSession) => void;
    const savePromise = new Promise<NoteSession>((resolve) => {
      resolveSave = resolve;
    });
    const markNoteOpened = vi.fn().mockResolvedValue(undefined);
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: vi.fn().mockReturnValue(savePromise),
      markNoteOpened,
      documentEditing: editingServiceFor(note),
    });

    const save = controller.enqueueSave(note);
    await vi.waitFor(() => expect(note.operation.kind).toBe("saving"));
    // User keeps typing while the disk write is in flight.
    updateDocumentMarkdown(note, "first line\nsecond line");
    resolveSave(
      committedSnapshot({
        title: "first line",
        bodyMarkdown: "first line",
        currentNoteId: "note-id",
        currentNotePath: "/vault/first line.md",
        lastSavedTitle: "first line",
        lastSavedMarkdown: "first line",
        lastSavedNoteId: "note-id",
        lastSavedPath: "/vault/first line.md",
      }),
    );
    await save;

    // The persisted identity is adopted so the next autosave updates the
    // same file instead of creating a duplicate.
    expect(getDocumentPath(note)).toBe("/vault/first line.md");
    expect(getDocumentNoteId(note)).toBe("note-id");
    expect(note.savedBaseline?.identity).toEqual({
      kind: "persisted",
      noteId: "note-id",
      path: "/vault/first line.md",
    });
    // The newer draft body the user typed is preserved.
    expect(note.working.markdown).toBe("first line\nsecond line");
    expect(markNoteOpened).toHaveBeenCalledWith("note-id");
    expect(note.operation.kind).toBe("idle");
  });

  it("adopts a new note path when required projections fail after commit", async () => {
    const note = createNoteDraftState({
      title: "New note",
      bodyMarkdown: "body",
      currentNoteId: null,
      currentNotePath: null,
      lastSavedTitle: "",
      lastSavedMarkdown: "",
      lastSavedNoteId: null,
      lastSavedPath: null,
    });
    const warning = {
      message: "Canonical note file was saved; task projection is pending",
      issues: [
        {
          stage: "taskProjectionUpsert",
          message: "task database unavailable",
        },
      ],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: vi.fn().mockResolvedValue(
        committedSnapshot({
          title: "New note",
          bodyMarkdown: "body",
          currentNoteId: "note-new",
          currentNotePath: "/vault/New note.md",
          lastSavedTitle: "New note",
          lastSavedMarkdown: "body",
          lastSavedNoteId: "note-new",
          lastSavedPath: "/vault/New note.md",
          commitWarning: warning,
        }),
      ),
      documentEditing: editingServiceFor(note),
    });

    await expect(controller.enqueueSave(note)).resolves.toBeUndefined();

    expect(getDocumentPath(note)).toBe("/vault/New note.md");
    expect(getDocumentNoteId(note)).toBe("note-new");
    expect(note.operation.kind).toBe("idle");
    expect(note.publication.warning).toEqual(warning);
    expect(getDocumentStatusViewModel(note)).toEqual({
      kind: "warning",
      label: "Canonical note file was saved; task projection is pending",
      hasUnsavedChanges: false,
      repairAction: "automatic",
    });
    updateDocumentMarkdown(note, "newer dirty work");
    expect(getDocumentStatusViewModel(note)).toEqual({
      kind: "warning",
      label: "Canonical note file was saved; task projection is pending",
      hasUnsavedChanges: true,
      repairAction: "automatic",
    });
    expect(warn).toHaveBeenCalledWith(
      "Note was saved, but required projections need repair:",
      warning,
    );
  });

  it("does not let an inactive draft replace the session restore note", async () => {
    const note = createNoteDraftState({
      title: "Background draft",
      bodyMarkdown: "body",
      currentNoteId: null,
      currentNotePath: null,
      lastSavedTitle: "",
      lastSavedMarkdown: "",
      lastSavedNoteId: null,
      lastSavedPath: null,
    });
    const saveNoteSession = vi.fn().mockResolvedValue(
      committedSnapshot({
        title: "Background draft",
        bodyMarkdown: "body",
        currentNotePath: "/vault/Background draft.md",
      }),
    );
    const markNoteOpened = vi.fn().mockResolvedValue(undefined);
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession,
      markNoteOpened,
      isActiveNote: () => false,
      documentEditing: editingServiceFor(note),
    });

    await controller.enqueueSave(note);

    expect(saveNoteSession).toHaveBeenCalledWith(
      "Background draft",
      "body",
      null,
    );
    expect(markNoteOpened).not.toHaveBeenCalled();
  });

  it("does not persist across an unresolved external conflict", async () => {
    const note = dirtyNote();
    captureExternalSnapshotForTest(
      note,
      snapshot({
        bodyMarkdown: "external body",
        lastSavedMarkdown: "external body",
      }),
      "watcher",
    );
    const saveNoteSession = vi.fn();
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession,
      documentEditing: editingServiceFor(note),
    });

    await controller.enqueueSave(note);

    expect(saveNoteSession).not.toHaveBeenCalled();
    expect(note.externalSync.kind).toBe("conflict");
  });

  it("retains a post-commit collision and never resubmits the completed write", async () => {
    const established = dirtyNote();
    updateDocumentMarkdown(established, "established dirty draft");
    const state = createNotepadState(established);
    bindNotepadStateToVault(state, "/vault");
    const savingDraft = createFreshDraftNote(state);
    updateDocumentMarkdown(savingDraft, "captured independent draft");
    let resolveSave!: (snapshot: NoteSession) => void;
    const saveNoteSession = vi.fn().mockImplementation(
      () => new Promise<NoteSession>((resolve) => {
        resolveSave = resolve;
      })
    );
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => savingDraft,
      saveNoteSession,
      documentEditing: editingServiceForState(state),
    });

    const save = controller.enqueueSave(savingDraft);
    await vi.waitFor(() => expect(savingDraft.operation.kind).toBe("saving"));
    updateDocumentMarkdown(savingDraft, "newer independent draft");
    resolveSave(committed({
      title: "captured independent draft",
      markdown: "captured independent draft",
      noteId: "note-id",
      path: "/vault/Saved.md",
    }));
    await save;

    expect(saveNoteSession).toHaveBeenCalledTimes(1);
    expect(savingDraft.savedBaseline?.content.markdown).toBe(
      "captured independent draft"
    );
    expect(savingDraft.working.markdown).toBe("newer independent draft");
    expect(established.working.markdown).toBe("established dirty draft");
    expect(savingDraft.canonicalCollision?.otherHandle).toBe(
      established.handle
    );
    expect(savingDraft.operation.kind).toBe("idle");

    await controller.enqueueSave(savingDraft);
    expect(saveNoteSession).toHaveBeenCalledTimes(1);
    expect(savingDraft.working.markdown).toBe("newer independent draft");
  });

  it("preserves dirty editor content when durable history preparation fails", async () => {
    const note = dirtyNote();
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: vi
        .fn()
        .mockRejectedValue(new Error("history preparation unavailable")),
      documentEditing: editingServiceFor(note),
    });

    await expect(controller.enqueueSave(note)).rejects.toThrow(
      "history preparation unavailable",
    );
    expect(note.operation).toMatchObject({
      kind: "failed",
      failedOperation: "saving",
      message: "history preparation unavailable",
    });
    expect(getDocumentTitle(note)).toBe("Draft");
    expect(getDocumentMarkdown(note)).toBe("draft body");
    expect(controller.hasCleanBuffer(note)).toBe(false);
  });
  it("starts the one real save before delayed serial observations and preserves a newer draft", async () => {
    const note = dirtyNote();
    let resolveSave!: (snapshot: NoteSession) => void;
    let resolveObservation!: (value: import('$lib/contracts/historyReadiness').HistoryReadiness) => void;
    const saveNoteSession = vi.fn().mockImplementation(() => new Promise<NoteSession>((resolve) => { resolveSave = resolve; }));
    const loadHistoryReadiness = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveObservation = resolve; }));
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note, saveNoteSession, loadHistoryReadiness,
      documentEditing: editingServiceFor(note)
    });
    const saved = controller.enqueueSave(note);
    await vi.advanceTimersByTimeAsync(0);
    expect(saveNoteSession).toHaveBeenCalledTimes(1);
    expect(loadHistoryReadiness).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadHistoryReadiness).toHaveBeenCalledTimes(1);
    const readiness = { scope: 'runtime', revision: 0, noteId: 'note-id', state: 'targetVerificationPending' as const,
      verifiedNotes: 1, totalNotes: 10, backgroundComplete: false, backgroundUnavailable: false };
    resolveObservation(readiness);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDocumentStatusViewModel(note)).toMatchObject({ kind: 'busy', label: expect.stringContaining('checking this note') });
    updateDocumentMarkdown(note, 'newer typing');
    expect(controller.hasCleanBuffer(note)).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    resolveSave(committedSnapshot({ title: 'Draft', bodyMarkdown: 'draft body', lastSavedTitle: 'Draft', lastSavedMarkdown: 'draft body' }));
    await saved;
    resolveObservation(readiness);
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadHistoryReadiness).toHaveBeenCalledTimes(2);
    expect(note.operation).not.toHaveProperty('waitReason');
    expect(getDocumentStatusViewModel(note)).toEqual({ kind: 'dirty', label: 'Unsaved changes' });
    expect(getDocumentMarkdown(note)).toBe('newer typing');
  });

  it.each([
    ['recoveryPending', 'recovery'],
    ['targetVerificationPending', 'verification'],
    ['unavailable', 'unavailable'],
    ['corrupt', 'corrupt'],
    ['ready', undefined],
  ] as const)('presents %s as advisory progress without completing the save', async (state, waitReason) => {
    const note = dirtyNote();
    let resolveSave!: (value: NoteSession) => void;
    const loadHistoryReadiness = vi.fn().mockResolvedValue({
      scope: 'runtime', revision: 0, noteId: 'note-id', state,
      verifiedNotes: 1, totalNotes: 1, backgroundComplete: true, backgroundUnavailable: false,
    });
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: () => new Promise((resolve) => { resolveSave = resolve; }),
      loadHistoryReadiness, documentEditing: editingServiceFor(note),
    });
    const saved = controller.enqueueSave(note);
    await vi.advanceTimersByTimeAsync(250);
    expect(note.operation).toMatchObject({ kind: 'saving', waitReason });
    expect(note.operation).not.toHaveProperty('readiness');
    expect(controller.hasCleanBuffer(note)).toBe(false);
    expect(getDocumentStatusViewModel(note).kind).toBe('busy');
    resolveSave(committed());
    await saved;
  });

  it.each(['failure', 'warning'] as const)("observer failure never replaces the authoritative %s", async (outcome) => {
    const note = dirtyNote();
    let resolveSave!: (value: NoteSession) => void;
    let rejectSave!: (error: Error) => void;
    const loadHistoryReadiness = vi.fn().mockRejectedValue(new Error('observer offline'));
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: () => new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }),
      loadHistoryReadiness, documentEditing: editingServiceFor(note)
    });
    const saved = controller.enqueueSave(note);
    const result = saved.catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadHistoryReadiness).toHaveBeenCalledTimes(1);
    if (outcome === 'failure') {
      rejectSave(new Error('Authoritative preparation failure'));
      expect(await result).toBe('Authoritative preparation failure');
      expect(getDocumentStatusViewModel(note)).toEqual({ kind: 'failed', label: 'Authoritative preparation failure' });
      expect(controller.hasCleanBuffer(note)).toBe(false);
    } else {
      const commitWarning = { message: 'History capture pending', issues: [{ stage: 'historyFinalization', message: 'retry' }] };
      resolveSave(committedSnapshot({ title: 'Draft', bodyMarkdown: 'draft body', lastSavedTitle: 'Draft', lastSavedMarkdown: 'draft body', commitWarning }));
      await result;
      expect(getDocumentStatusViewModel(note)).toMatchObject({ kind: 'warning', hasUnsavedChanges: false, repairAction: 'historySettings' });
      expect(note.publication.warning).toEqual(commitWarning);
    }
    expect(note.operation).not.toHaveProperty('waitReason');
  });

  it.each(['scope', 'revision', 'noteId'] as const)('ignores a changed observation %s without changing the pending save', async (field) => {
    const note = dirtyNote();
    let resolveSave!: (value: NoteSession) => void;
    const readiness = { scope: 'runtime', revision: 0, noteId: 'note-id', state: 'recoveryPending' as const,
      verifiedNotes: 0, totalNotes: null, backgroundComplete: false, backgroundUnavailable: false };
    const loadHistoryReadiness = vi.fn().mockResolvedValueOnce(readiness).mockResolvedValue({ ...readiness, [field]: field === 'revision' ? 1 : 'replacement' });
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note, saveNoteSession: () => new Promise((resolve) => { resolveSave = resolve; }),
      loadHistoryReadiness, documentEditing: editingServiceFor(note)
    });
    const saved = controller.enqueueSave(note);
    await vi.advanceTimersByTimeAsync(500);
    expect(note.operation.kind).toBe('saving');
    expect(controller.hasCleanBuffer(note)).toBe(false);
    expect(note.operation).toMatchObject({ waitReason: field === 'noteId' ? 'recovery' : undefined });
    expect(note.operation).not.toHaveProperty('readiness');
    resolveSave(committed());
    await saved;
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadHistoryReadiness).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('new draft observes only recovery; navigation drains the newest assigned-ID save (failure=%s)', async (failFollowup) => {
    const note = createNoteDraftState({ title: 'Draft', bodyMarkdown: 'first', currentNoteId: null, currentNotePath: null,
      lastSavedTitle: '', lastSavedMarkdown: '', lastSavedNoteId: null, lastSavedPath: null });
    let resolveFirst!: (value: NoteSession) => void;
    let resolveSecond!: (value: NoteSession) => void;
    let rejectSecond!: (error: Error) => void;
    const saveNoteSession = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveSecond = resolve; rejectSecond = reject; }))
      .mockRejectedValue(new Error('History became unavailable'));
    const readiness = { scope: 'runtime', revision: 0, noteId: null, state: 'recoveryPending' as const,
      verifiedNotes: 0, totalNotes: null, backgroundComplete: false, backgroundUnavailable: false };
    const loadHistoryReadiness = vi.fn().mockResolvedValueOnce(readiness).mockResolvedValue({ ...readiness, state: 'targetVerificationPending' });
    const controller = createNotepadPersistenceController({ getDocumentSession: () => note, saveNoteSession, loadHistoryReadiness,
      documentEditing: editingServiceFor(note) });
    const first = controller.enqueueSave(note).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(250);
    expect(getDocumentStatusViewModel(note)).toMatchObject({ historyWaiting: true, label: expect.stringContaining('recovering') });
    await vi.advanceTimersByTimeAsync(250);
    expect(getDocumentStatusViewModel(note)).toEqual({ kind: 'busy', label: 'Saving…' });
    updateDocumentMarkdown(note, 'newest typing');
    const coalesced = controller.enqueueSave(note).catch((error: Error) => error.message);
    const workspace = createWorkspacePersistenceService({ getDocuments: () => [note], flushAllPaneCursorSaves: vi.fn(),
      cancelPendingAutosave: controller.cancelPendingAutosave, enqueueSave: controller.enqueueSave });
    const navigated = vi.fn();
    const departure = workspace.flushAllForNavigation().then(navigated).catch((error: Error) => error.message);
    resolveFirst(committedSnapshot({ title: 'Draft', bodyMarkdown: 'first', lastSavedTitle: 'Draft', lastSavedMarkdown: 'first' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(saveNoteSession).toHaveBeenNthCalledWith(2, 'Draft', 'newest typing', '/vault/Saved.md');
    expect(getDocumentNoteId(note)).toBe('note-id'); expect(navigated).not.toHaveBeenCalled();
    expect(controller.hasCleanBuffer(note)).toBe(false);
    if (failFollowup) rejectSecond(new Error('History became unavailable'));
    else resolveSecond(committedSnapshot({ title: 'Draft', bodyMarkdown: 'newest typing', lastSavedTitle: 'Draft', lastSavedMarkdown: 'newest typing' }));
    await Promise.all([first, coalesced, departure]);
    expect(getDocumentMarkdown(note)).toBe('newest typing');
    expect(navigated).toHaveBeenCalledTimes(failFollowup ? 0 : 1);
    expect(controller.hasCleanBuffer(note)).toBe(!failFollowup);
    expect(note.operation).not.toHaveProperty('waitReason');
  });

});
