import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotepadPersistenceController } from "./persistenceController";
import {
  createNoteDraftState,
  type NoteDraftState,
} from "$lib/features/notepad/state/noteStore";
import type { SessionSnapshot } from "$lib/features/notepad/session/session";

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
      timers: new Map(),
      queues: new Map(),
      saveNoteSession,
      rekeyNoteWithRuntime: (currentNote) => currentNote,
    });

    controller.scheduleAutosave(note);
    await vi.advanceTimersByTimeAsync(1000);
    await controller.getNoteSaveQueue(note.key);

    expect(saveNoteSession).toHaveBeenCalledWith(
      "Draft",
      "draft body",
      "/vault/Saved.md",
    );
    expect(note.status).toBe("idle");
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
      timers: new Map(),
      queues: new Map(),
      saveNoteSession: vi.fn().mockReturnValue(savePromise),
      rekeyNoteWithRuntime: (currentNote) => currentNote,
    });

    const save = controller.enqueueSave(note);
    await vi.waitFor(() => expect(note.status).toBe("saving"));
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

    expect(note.status).toBe("saving");
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
    const controller = createNotepadPersistenceController({
      getDocumentSession: () => note,
      timers: new Map(),
      queues: new Map(),
      saveNoteSession: vi.fn().mockReturnValue(savePromise),
      rekeyNoteWithRuntime: (currentNote) => currentNote,
    });

    const save = controller.enqueueSave(note);
    await vi.waitFor(() => expect(note.status).toBe("saving"));
    // User keeps typing while the disk write is in flight.
    note.bodyMarkdown = "first line\nsecond line";
    note.operationRevision += 1;
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
    expect(note.currentNotePath).toBe("/vault/first line.md");
    expect(note.currentNoteId).toBe("note-id");
    expect(note.lastSavedPath).toBe("/vault/first line.md");
    // The newer draft body the user typed is preserved.
    expect(note.bodyMarkdown).toBe("first line\nsecond line");
    expect(note.status).toBe("idle");
  });
});
