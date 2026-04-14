import {
  createEmptySessionSnapshot,
  type ForgottenNote,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';

export type NoteKey = `path:${string}` | `draft:${string}`;
export type NoteStatus = 'idle' | 'saving' | 'remembering' | 'forgetting' | 'opening' | 'error';

export interface NoteDraftState extends SessionSnapshot {
  key: NoteKey;
  status: NoteStatus;
  operationRevision: number;
}

export interface PaneState<TPaneId extends string = string> {
  paneId: TPaneId;
  kind: 'editor' | 'chat';
  noteKey: NoteKey;
}

export interface NotepadState<TPaneId extends string = string> {
  activePaneId: TPaneId;
  panesById: Record<TPaneId, PaneState<TPaneId>>;
  notesByKey: Record<string, NoteDraftState>;
  recentlyForgotten: ForgottenNote | null;
  isRefreshingFromDisk: boolean;
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
  return {
    key,
    ...snapshot,
    status: 'idle',
    operationRevision: 0
  };
}

export function createNotepadState<TPaneId extends string>(
  primaryPaneId: TPaneId,
  allPaneIds: readonly TPaneId[]
): NotepadState<TPaneId> {
  const initialNote = createNoteDraftState();
  const panesById = Object.fromEntries(
    allPaneIds.map((paneId) => [
      paneId,
      {
        paneId,
        kind: 'editor',
        noteKey: initialNote.key
      }
    ])
  ) as Record<TPaneId, PaneState<TPaneId>>;

  return {
    activePaneId: primaryPaneId,
    panesById,
    notesByKey: {
      [initialNote.key]: initialNote
    },
    recentlyForgotten: null,
    isRefreshingFromDisk: false
  };
}

export function getPaneState<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  paneId: TPaneId
): PaneState<TPaneId> {
  return state.panesById[paneId];
}

export function getPaneNote<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  paneId: TPaneId
): NoteDraftState {
  return state.notesByKey[state.panesById[paneId].noteKey];
}

export function getActiveNote<TPaneId extends string>(state: NotepadState<TPaneId>) {
  return getPaneNote(state, state.activePaneId);
}

export function setActivePane<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  paneId: TPaneId
) {
  state.activePaneId = paneId;
}

export function setPaneKind<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  paneId: TPaneId,
  kind: PaneState<TPaneId>['kind']
) {
  state.panesById[paneId].kind = kind;
}

export function setPaneNoteKey<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  paneId: TPaneId,
  noteKey: NoteKey
) {
  state.panesById[paneId].noteKey = noteKey;
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

export function replaceReferencedNoteWithFreshDraft<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  noteKey: NoteKey
) {
  const freshDraft = createFreshDraftNote(state);
  for (const pane of Object.values(state.panesById) as PaneState<TPaneId>[]) {
    if (pane.noteKey === noteKey) {
      pane.noteKey = freshDraft.key;
    }
  }
  delete state.notesByKey[noteKey];
  return freshDraft;
}

export function updateNoteDraftTitle(note: NoteDraftState, title: string) {
  if (note.title === title) {
    return;
  }

  note.title = title;
  note.operationRevision += 1;
}

export function updateNoteDraftMarkdown(note: NoteDraftState, markdown: string) {
  if (note.bodyMarkdown === markdown) {
    return;
  }

  note.bodyMarkdown = markdown;
  note.operationRevision += 1;
}

export function setNoteStatus(note: NoteDraftState, status: NoteStatus) {
  note.status = status;
}

export function applySnapshotToNote(
  note: NoteDraftState,
  snapshot: SessionSnapshot,
  { preserveDraft = false }: { preserveDraft?: boolean } = {}
) {
  if (preserveDraft) {
    note.currentNoteId = snapshot.currentNoteId;
    note.currentNotePath = snapshot.currentNotePath;
    note.lastSavedTitle = snapshot.lastSavedTitle;
    note.lastSavedMarkdown = snapshot.lastSavedMarkdown;
    note.lastSavedNoteId = snapshot.lastSavedNoteId;
    note.lastSavedPath = snapshot.lastSavedPath;
    return;
  }

  note.title = snapshot.title;
  note.bodyMarkdown = snapshot.bodyMarkdown;
  note.currentNoteId = snapshot.currentNoteId;
  note.currentNotePath = snapshot.currentNotePath;
  note.lastSavedTitle = snapshot.lastSavedTitle;
  note.lastSavedMarkdown = snapshot.lastSavedMarkdown;
  note.lastSavedNoteId = snapshot.lastSavedNoteId;
  note.lastSavedPath = snapshot.lastSavedPath;
}

export function rekeyNote<TPaneId extends string>(
  state: NotepadState<TPaneId>,
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
    for (const pane of Object.values(state.panesById) as PaneState<TPaneId>[]) {
      if (pane.noteKey === oldKey) {
        pane.noteKey = nextKey;
      }
    }
    delete state.notesByKey[oldKey];
    return existing;
  }

  delete state.notesByKey[oldKey];
  note.key = nextKey;
  state.notesByKey[nextKey] = note;
  for (const pane of Object.values(state.panesById) as PaneState<TPaneId>[]) {
    if (pane.noteKey === oldKey) {
      pane.noteKey = nextKey;
    }
  }
  return note;
}

export function removeNoteIfUnreferenced<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  noteKey: NoteKey
) {
  if ((Object.values(state.panesById) as PaneState<TPaneId>[]).some((pane) => pane.noteKey === noteKey)) {
    return;
  }
  delete state.notesByKey[noteKey];
}

export function listReferencedNoteKeys<TPaneId extends string>(state: NotepadState<TPaneId>) {
  return [
    ...new Set((Object.values(state.panesById) as PaneState<TPaneId>[]).map((pane) => pane.noteKey))
  ];
}

export function adoptSnapshotForPane<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  paneId: TPaneId,
  snapshot: SessionSnapshot
) {
  const nextPersistedKey = noteKeyFromPath(snapshot.currentNotePath);
  const currentNote = getPaneNote(state, paneId);

  if (nextPersistedKey) {
    const existing = state.notesByKey[nextPersistedKey];
    const note =
      existing ??
      createNoteDraftState(snapshot, nextPersistedKey);
    applySnapshotToNote(note, snapshot);
    state.notesByKey[note.key] = note;
    state.panesById[paneId].noteKey = note.key;
    removeNoteIfUnreferenced(state, currentNote.key);
    return note;
  }

  if (currentNote.key.startsWith('draft:')) {
    applySnapshotToNote(currentNote, snapshot);
    return currentNote;
  }

  const freshDraft = createNoteDraftState(snapshot);
  state.notesByKey[freshDraft.key] = freshDraft;
  state.panesById[paneId].noteKey = freshDraft.key;
  removeNoteIfUnreferenced(state, currentNote.key);
  return freshDraft;
}
