import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotepadPersistenceController } from "./persistenceController";
import {
  createNoteDraftState,
  type NoteDraftState,
} from "$lib/features/notepad/state/noteStore";
import type { SessionSnapshot } from "$lib/features/notepad/session/session";
import {
  applySessionSnapshotToDocument,
  captureExternalSnapshotConflict,
  getDocumentNoteId,
  getDocumentPath,
  updateDocumentMarkdown,
} from "$lib/features/notepad/document/documentState";

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

function applySavedSnapshot(
  note: NoteDraftState,
  saved: SessionSnapshot,
  { preserveDraft }: { preserveDraft: boolean },
) {
  applySessionSnapshotToDocument(note, saved, {
    preserveWorking: preserveDraft,
  });
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

  it("schedules autosave through the note queue and clears clean buffers", async () => {
    const note = dirtyNote();
    const saveNoteSession = vi.fn().mockResolvedValue(
      snapshot({
        title: "Draft",
        bodyMarkdown: "draft body",
        lastSavedTitle: "Draft",
        lastSavedMarkdown: "draft body",
      }),
    );
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession,
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      applySavedSnapshot,
    });

    controller.scheduleAutosave(note);
    await vi.advanceTimersByTimeAsync(1000);
    await controller.getNoteSaveQueue(note.key);

    expect(saveNoteSession).toHaveBeenCalledWith(
      "Draft",
      "draft body",
      "/vault/Saved.md",
    );
    expect(note.operation.kind).toBe("idle");
    expect(controller.hasCleanBuffer(note)).toBe(true);
  });

  it("does not apply save results after a deliberate invalidation", async () => {
    const note = dirtyNote();
    let resolveSave!: (snapshot: SessionSnapshot) => void;
    const savePromise = new Promise<SessionSnapshot>((resolve) => {
      resolveSave = resolve;
    });
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: vi.fn().mockReturnValue(savePromise),
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      applySavedSnapshot,
    });

    const save = controller.enqueueSave(note);
    await vi.waitFor(() => expect(note.operation.kind).toBe("saving"));
    controller.invalidatePendingSaveResults(note);
    resolveSave(
      snapshot({
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
    let resolveSave!: (snapshot: SessionSnapshot) => void;
    const savePromise = new Promise<SessionSnapshot>((resolve) => {
      resolveSave = resolve;
    });
    const markNoteOpened = vi.fn().mockResolvedValue(undefined);
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: vi.fn().mockReturnValue(savePromise),
      markNoteOpened,
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      applySavedSnapshot,
    });

    const save = controller.enqueueSave(note);
    await vi.waitFor(() => expect(note.operation.kind).toBe("saving"));
    // User keeps typing while the disk write is in flight.
    updateDocumentMarkdown(note, "first line\nsecond line");
    resolveSave(
      snapshot({
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
        snapshot({
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
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      applySavedSnapshot,
    });

    await expect(controller.enqueueSave(note)).resolves.toBeUndefined();

    expect(getDocumentPath(note)).toBe("/vault/New note.md");
    expect(getDocumentNoteId(note)).toBe("note-new");
    expect(note.operation.kind).toBe("idle");
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
      snapshot({
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
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      applySavedSnapshot,
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
    captureExternalSnapshotConflict(
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
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      applySavedSnapshot,
    });

    await controller.enqueueSave(note);

    expect(saveNoteSession).not.toHaveBeenCalled();
    expect(note.externalSync.kind).toBe("conflict");
  });

  it("rejects an explicit save barrier while retaining a retryable failed document", async () => {
    const note = dirtyNote();
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      saveNoteSession: vi
        .fn()
        .mockRejectedValue(new Error("disk unavailable")),
      rekeyNoteWithRuntime: (currentNote) => currentNote,
      applySavedSnapshot,
    });

    await expect(controller.enqueueSave(note)).rejects.toThrow(
      "disk unavailable",
    );
    expect(note.operation).toMatchObject({
      kind: "failed",
      failedOperation: "saving",
      message: "disk unavailable",
    });
    expect(controller.hasCleanBuffer(note)).toBe(false);
  });
});
