import {
  createEmptySessionSnapshot,
  type ForgottenNote,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  applySessionSnapshotToDocument,
  createDocumentState,
  getDocumentPath,
  type NoteDraftState,
  type NoteKey
} from '$lib/features/notepad/document/documentState';

export type {
  NoteDraftState,
  NoteKey
} from '$lib/features/notepad/document/documentState';

export interface PaneNoteReferences<TPaneId extends string> {
  getPaneState: (paneId: TPaneId) => { noteKey: NoteKey };
  setPaneNoteKey: (paneId: TPaneId, noteKey: NoteKey) => void;
  replaceNoteKeyReferences: (
    previousKey: NoteKey,
    nextKey: NoteKey
  ) => void;
  isNoteReferenced: (noteKey: NoteKey) => boolean;
  listReferencedNoteKeys: () => NoteKey[];
}

/** Document lifecycle state. Pane structure and references live in WorkspaceStore. */
export interface NotepadState<TPaneId extends string = string> {
  notesByKey: Record<string, NoteDraftState>;
  recentlyForgotten: ForgottenNote | null;
}

let draftCounter = 0;

export function createDraftNoteKey(): NoteKey {
  draftCounter += 1;
  return `draft:${draftCounter}`;
}

export function noteKeyFromPath(path: string | null): NoteKey | null {
  return path ? (`path:${path}` as NoteKey) : null;
}

export function createNoteDraftState(
  snapshot: SessionSnapshot = createEmptySessionSnapshot(),
  key: NoteKey = noteKeyFromPath(snapshot.currentNotePath) ?? createDraftNoteKey()
): NoteDraftState {
  return createDocumentState(snapshot, key);
}

export function createNotepadState<TPaneId extends string = string>(
  initialNote: NoteDraftState = createNoteDraftState()
): NotepadState<TPaneId> {
  return {
    notesByKey: {
      [initialNote.key]: initialNote
    },
    recentlyForgotten: null
  };
}

export function getPaneNote<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneNoteReferences<TPaneId>,
  paneId: TPaneId
): NoteDraftState {
  return state.notesByKey[
    references.getPaneState(paneId).noteKey
  ];
}

export function upsertNote<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  note: NoteDraftState
) {
  state.notesByKey[note.key] = note;
  return note;
}

export function createFreshDraftNote<TPaneId extends string>(state: NotepadState<TPaneId>) {
  const note = createNoteDraftState();
  state.notesByKey[note.key] = note;
  return note;
}

export function replacePaneReferenceWithFreshDraft<
  TPaneId extends string
>(
  state: NotepadState<TPaneId>,
  references: PaneNoteReferences<TPaneId>,
  paneId: TPaneId
) {
  const freshDraft = createFreshDraftNote(state);
  references.setPaneNoteKey(paneId, freshDraft.key);
  return freshDraft;
}

export function replaceReferencedNoteWithFreshDraft<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneNoteReferences<TPaneId>,
  noteKey: NoteKey
) {
  const freshDraft = createFreshDraftNote(state);
  references.replaceNoteKeyReferences(
    noteKey,
    freshDraft.key
  );
  delete state.notesByKey[noteKey];
  return freshDraft;
}

export function rekeyNote<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneNoteReferences<TPaneId>,
  oldKey: NoteKey,
  nextKey: NoteKey
) {
  if (oldKey === nextKey) {
    return state.notesByKey[oldKey] ?? null;
  }

  const note = state.notesByKey[oldKey];
  if (!note) {
    return null;
  }

  const existing = state.notesByKey[nextKey];
  if (existing && existing !== note) {
    references.replaceNoteKeyReferences(oldKey, nextKey);
    delete state.notesByKey[oldKey];
    return existing;
  }

  delete state.notesByKey[oldKey];
  note.key = nextKey;
  state.notesByKey[nextKey] = note;
  references.replaceNoteKeyReferences(oldKey, nextKey);
  return note;
}

export function removeNoteIfUnreferenced<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneNoteReferences<TPaneId>,
  noteKey: NoteKey
) {
  if (references.isNoteReferenced(noteKey)) {
    return;
  }
  delete state.notesByKey[noteKey];
}

function removeTransientNoteIfUnreferenced<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneNoteReferences<TPaneId>,
  noteKey: NoteKey
) {
  const note = state.notesByKey[noteKey];
  if (!note || getDocumentPath(note)) {
    return;
  }

  removeNoteIfUnreferenced(state, references, noteKey);
}

export function listReferencedNoteKeys<TPaneId extends string>(
  references: PaneNoteReferences<TPaneId>
) {
  return references.listReferencedNoteKeys();
}

export function adoptSnapshotForPane<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneNoteReferences<TPaneId>,
  paneId: TPaneId,
  snapshot: SessionSnapshot
) {
  const nextPersistedKey = noteKeyFromPath(snapshot.currentNotePath);
  const currentNote = getPaneNote(
    state,
    references,
    paneId
  );

  if (nextPersistedKey) {
    const existing = state.notesByKey[nextPersistedKey];
    const note =
      existing ??
      createNoteDraftState(snapshot, nextPersistedKey);
    applySessionSnapshotToDocument(note, snapshot);
    state.notesByKey[note.key] = note;
    references.setPaneNoteKey(paneId, note.key);
    removeTransientNoteIfUnreferenced(
      state,
      references,
      currentNote.key
    );
    return note;
  }

  if (currentNote.key.startsWith('draft:')) {
    applySessionSnapshotToDocument(currentNote, snapshot);
    return currentNote;
  }

  const freshDraft = createNoteDraftState(snapshot);
  state.notesByKey[freshDraft.key] = freshDraft;
  references.setPaneNoteKey(paneId, freshDraft.key);
  removeTransientNoteIfUnreferenced(
    state,
    references,
    currentNote.key
  );
  return freshDraft;
}
