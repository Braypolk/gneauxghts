import {
  createEmptySessionSnapshot,
  type ForgottenNote,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import type { NoteSession } from '$lib/features/notepad/model/types';
import {
  applyCommittedNoteToDocument,
  applySessionSnapshotToDocument,
  createDocumentState,
  documentHasCleanBuffer,
  getDocumentNoteId,
  getDocumentPath,
  type DocumentHandle,
  type NoteDraftState
} from '$lib/features/notepad/document/documentState';

export type {
  DocumentHandle,
  NoteDraftState
} from '$lib/features/notepad/document/documentState';

export interface PaneDocumentReferences<TPaneId extends string> {
  getPaneState: (paneId: TPaneId) => { documentHandle: DocumentHandle };
  setPaneDocumentHandle: (
    paneId: TPaneId,
    documentHandle: DocumentHandle
  ) => void;
  replaceDocumentHandleReferences: (
    previousHandle: DocumentHandle,
    nextHandle: DocumentHandle
  ) => void;
  isDocumentReferenced: (documentHandle: DocumentHandle) => boolean;
  listReferencedDocumentHandles: () => DocumentHandle[];
}

/** Document lifecycle state. Pane structure and references live in WorkspaceStore. */
export interface NotepadState<TPaneId extends string = string> {
  documentsByHandle: Record<string, NoteDraftState>;
  /** Bound running-vault root. Ephemeral handles never cross this boundary. */
  vaultRoot: string | null;
  /** One identity/path-to-handle index for this running vault. */
  canonicalDocumentLookup: Record<string, DocumentHandle>;
  recentlyForgotten: ForgottenNote | null;
}

let documentHandleCounter = 0;

function createDocumentHandle(): DocumentHandle {
  documentHandleCounter += 1;
  return `document:${documentHandleCounter}`;
}

function normalizeVaultRoot(vaultRoot: string) {
  return vaultRoot.replace(/[\\/]+$/u, '');
}

function canonicalLookupKeys(
  vaultRoot: string,
  noteId: string | null,
  path: string | null
) {
  const scope = normalizeVaultRoot(vaultRoot);
  return [
    ...(noteId ? [`${scope}\u0000identity:${noteId}`] : []),
    ...(path ? [`${scope}\u0000path:${path}`] : [])
  ];
}

function documentLookupKeys(
  state: NotepadState,
  document: NoteDraftState
) {
  if (!state.vaultRoot) return [];
  return canonicalLookupKeys(
    state.vaultRoot,
    getDocumentNoteId(document),
    getDocumentPath(document)
  );
}

function markCanonicalCollision(
  left: NoteDraftState,
  right: NoteDraftState,
  noteId: string | null,
  path: string
) {
  left.canonicalCollision = {
    otherHandle: right.handle,
    noteId,
    path
  };
  right.canonicalCollision = {
    otherHandle: left.handle,
    noteId,
    path
  };
}

function registerCanonicalDocument(
  state: NotepadState,
  document: NoteDraftState
) {
  const noteId = getDocumentNoteId(document);
  const path = getDocumentPath(document);
  const keys = documentLookupKeys(state, document);
  if (keys.length === 0) return null;
  const identityKey = noteId ? keys[0] : null;
  const pathKey = path ? keys[keys.length - 1] : null;
  const identityHandle = identityKey
    ? state.canonicalDocumentLookup[identityKey]
    : null;
  const pathHandle = pathKey
    ? state.canonicalDocumentLookup[pathKey]
    : null;
  const identityConflict = identityHandle && identityHandle !== document.handle
    ? state.documentsByHandle[identityHandle] ?? null
    : null;
  const pathConflict = pathHandle && pathHandle !== document.handle
    ? state.documentsByHandle[pathHandle] ?? null
    : null;
  const conflictingDocument = identityConflict ?? pathConflict;
  if (conflictingDocument) {
    if (path) {
      markCanonicalCollision(
        document,
        conflictingDocument,
        identityConflict ? noteId : null,
        path
      );
    }
    if (identityKey) {
      state.canonicalDocumentLookup[identityKey] = identityConflict
        ? identityConflict.handle
        : document.handle;
    }
    if (pathKey) {
      state.canonicalDocumentLookup[pathKey] = pathConflict
        ? pathConflict.handle
        : conflictingDocument.handle;
    }
    return conflictingDocument;
  }
  for (const key of keys) {
    state.canonicalDocumentLookup[key] = document.handle;
  }
  document.canonicalCollision = null;
  return null;
}

function rebuildCanonicalDocumentLookup(state: NotepadState) {
  state.canonicalDocumentLookup = {};
  for (const document of Object.values(state.documentsByHandle)) {
    document.canonicalCollision = null;
  }
  for (const document of Object.values(state.documentsByHandle)) {
    registerCanonicalDocument(state, document);
  }
}

export function bindNotepadStateToVault(
  state: NotepadState,
  vaultRoot: string
) {
  state.vaultRoot = normalizeVaultRoot(vaultRoot);
  rebuildCanonicalDocumentLookup(state);
}

export function findOpenDocument(
  state: NotepadState,
  reference: {
    vaultRoot?: string | null;
    noteId: string | null;
    path: string | null;
  }
): NoteDraftState | null {
  if (!state.vaultRoot) return null;
  if (
    reference.vaultRoot &&
    normalizeVaultRoot(reference.vaultRoot) !== state.vaultRoot
  ) {
    return null;
  }
  for (const key of canonicalLookupKeys(
    state.vaultRoot,
    reference.noteId,
    reference.path
  )) {
    const handle = state.canonicalDocumentLookup[key];
    if (handle) return state.documentsByHandle[handle] ?? null;
  }
  return null;
}

export function createNoteDraftState(
  snapshot: SessionSnapshot = createEmptySessionSnapshot()
): NoteDraftState {
  return createDocumentState(snapshot, createDocumentHandle());
}

export function createNotepadState<TPaneId extends string = string>(
  initialDocument: NoteDraftState = createNoteDraftState(),
  vaultRoot: string | null = null
): NotepadState<TPaneId> {
  const state: NotepadState<TPaneId> = {
    documentsByHandle: {
      [initialDocument.handle]: initialDocument
    },
    vaultRoot: vaultRoot ? normalizeVaultRoot(vaultRoot) : null,
    canonicalDocumentLookup: {},
    recentlyForgotten: null
  };
  rebuildCanonicalDocumentLookup(state);
  return state;
}

export function getPaneNote<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneDocumentReferences<TPaneId>,
  paneId: TPaneId
): NoteDraftState {
  return state.documentsByHandle[
    references.getPaneState(paneId).documentHandle
  ];
}

/** Store and return the canonical object exposed by the reactive container. */
function storeDocument<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  document: NoteDraftState
): NoteDraftState {
  state.documentsByHandle[document.handle] = document;
  const stored = state.documentsByHandle[document.handle];
  rebuildCanonicalDocumentLookup(state);
  return stored;
}

export function upsertNote<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  document: NoteDraftState
) {
  return storeDocument(state, document);
}

export function createFreshDraftNote<TPaneId extends string>(
  state: NotepadState<TPaneId>
) {
  return storeDocument(state, createNoteDraftState());
}

export function replacePaneReferenceWithFreshDraft<
  TPaneId extends string
>(
  state: NotepadState<TPaneId>,
  references: PaneDocumentReferences<TPaneId>,
  paneId: TPaneId
) {
  const freshDraft = createFreshDraftNote(state);
  references.setPaneDocumentHandle(paneId, freshDraft.handle);
  return freshDraft;
}

export function replaceReferencedNoteWithFreshDraft<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneDocumentReferences<TPaneId>,
  documentHandle: DocumentHandle
) {
  const freshDraft = createFreshDraftNote(state);
  references.replaceDocumentHandleReferences(
    documentHandle,
    freshDraft.handle
  );
  delete state.documentsByHandle[documentHandle];
  rebuildCanonicalDocumentLookup(state);
  return freshDraft;
}

export function removeNoteIfUnreferenced<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneDocumentReferences<TPaneId>,
  documentHandle: DocumentHandle
) {
  if (references.isDocumentReferenced(documentHandle)) return false;
  delete state.documentsByHandle[documentHandle];
  rebuildCanonicalDocumentLookup(state);
  return true;
}

function removeTransientNoteIfUnreferenced<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneDocumentReferences<TPaneId>,
  documentHandle: DocumentHandle
) {
  const document = state.documentsByHandle[documentHandle];
  if (!document || getDocumentPath(document)) return;
  removeNoteIfUnreferenced(state, references, documentHandle);
}

export function listReferencedDocumentHandles<TPaneId extends string>(
  references: PaneDocumentReferences<TPaneId>
) {
  return references.listReferencedDocumentHandles();
}

export type CommittedDocumentAdoption =
  | { kind: 'adopted'; document: NoteDraftState }
  | {
      kind: 'collision';
      document: NoteDraftState;
      conflictingDocument: NoteDraftState;
    };

/**
 * Atomically adopts committed identity/baseline and updates the vault-scoped
 * lookup. A collision is a retained in-memory conflict, never a document or
 * runtime merge and never permission to replay the canonical write.
 */
export function adoptCommittedDocument(
  state: NotepadState,
  document: NoteDraftState,
  committed: NoteSession,
  options: { preserveWorking?: boolean; preserveTags?: boolean } = {}
): CommittedDocumentAdoption {
  applyCommittedNoteToDocument(document, committed, options);
  rebuildCanonicalDocumentLookup(state);
  const conflictingDocument = document.canonicalCollision
    ? state.documentsByHandle[document.canonicalCollision.otherHandle] ?? null
    : null;
  return conflictingDocument
    ? { kind: 'collision', document, conflictingDocument }
    : { kind: 'adopted', document };
}

export function synchronizeDocumentCanonicalLookup(
  state: NotepadState,
  document: NoteDraftState
) {
  rebuildCanonicalDocumentLookup(state);
  return document.canonicalCollision
    ? state.documentsByHandle[document.canonicalCollision.otherHandle] ?? null
    : null;
}

export function adoptSnapshotForPane<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  references: PaneDocumentReferences<TPaneId>,
  paneId: TPaneId,
  snapshot: SessionSnapshot
) {
  const currentDocument = getPaneNote(state, references, paneId);
  const existing = findOpenDocument(state, {
    noteId: snapshot.currentNoteId,
    path: snapshot.currentNotePath
  });

  if (snapshot.currentNotePath) {
    const document = existing ?? createNoteDraftState(snapshot);
    if (existing) {
      applySessionSnapshotToDocument(document, snapshot, {
        preserveWorking: !documentHasCleanBuffer(document)
      });
    }
    const canonicalDocument = storeDocument(state, document);
    references.setPaneDocumentHandle(
      paneId,
      canonicalDocument.handle
    );
    removeTransientNoteIfUnreferenced(
      state,
      references,
      currentDocument.handle
    );
    return canonicalDocument;
  }

  if (currentDocument.identity.kind === 'draft') {
    applySessionSnapshotToDocument(currentDocument, snapshot);
    return currentDocument;
  }

  const freshDraft = storeDocument(
    state,
    createNoteDraftState(snapshot)
  );
  references.setPaneDocumentHandle(paneId, freshDraft.handle);
  removeTransientNoteIfUnreferenced(
    state,
    references,
    currentDocument.handle
  );
  return freshDraft;
}
