import type { EditorState } from 'prosemirror-state';
import {
  createEmptySessionSnapshot,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';

export const DEFAULT_DOCUMENT_PANE_ID = 'notepad-primary';

export interface DocumentSession extends SessionSnapshot {
  sharedEditorState: EditorState | null;
  sharedEditorStateGeneration: number;
  saveTimer: ReturnType<typeof window.setTimeout> | null;
  saveQueue: Promise<void>;
  operationRevision: number;
}

export interface PaneSession {
  paneId: string;
  document: DocumentSession;
}

export interface DocumentSessionStore {
  activePaneId: string;
  activePane: PaneSession;
  panesById: Map<string, PaneSession>;
  documentsByKey: Map<string, DocumentSession>;
}

function getDocumentKey(noteId: string | null, notePath: string | null) {
  if (notePath) {
    return `path:${notePath}`;
  }

  if (noteId) {
    return `id:${noteId}`;
  }

  return null;
}

export function createDocumentSession(
  snapshot: SessionSnapshot = createEmptySessionSnapshot()
): DocumentSession {
  return {
    ...snapshot,
    sharedEditorState: null,
    sharedEditorStateGeneration: 0,
    saveTimer: null,
    saveQueue: Promise.resolve(),
    operationRevision: 0
  };
}

export function createPaneSession(
  paneId: string = DEFAULT_DOCUMENT_PANE_ID,
  document: DocumentSession = createDocumentSession()
): PaneSession {
  return {
    paneId,
    document
  };
}

export function createDocumentSessionStore(
  paneId: string = DEFAULT_DOCUMENT_PANE_ID
): DocumentSessionStore {
  const emptyDocument = createDocumentSession();
  const activePane = createPaneSession(paneId, emptyDocument);

  return {
    activePaneId: paneId,
    activePane,
    panesById: new Map([[paneId, activePane]]),
    documentsByKey: new Map<string, DocumentSession>()
  };
}

export function getActivePaneSession(store: DocumentSessionStore) {
  return store.activePane;
}

export function getActiveDocumentSession(store: DocumentSessionStore) {
  return store.activePane.document;
}

export function applySnapshotToDocument(
  document: DocumentSession,
  snapshot: SessionSnapshot
) {
  document.title = snapshot.title;
  document.bodyMarkdown = snapshot.bodyMarkdown;
  document.currentNoteId = snapshot.currentNoteId;
  document.currentNotePath = snapshot.currentNotePath;
  document.lastSavedTitle = snapshot.lastSavedTitle;
  document.lastSavedMarkdown = snapshot.lastSavedMarkdown;
  document.lastSavedNoteId = snapshot.lastSavedNoteId;
  document.lastSavedPath = snapshot.lastSavedPath;
}

export function activateDocumentSession(
  store: DocumentSessionStore,
  snapshot: SessionSnapshot
) {
  const key = getDocumentKey(snapshot.currentNoteId, snapshot.currentNotePath);
  if (!key) {
    const document = createDocumentSession(snapshot);
    store.activePane.document = document;
    return document;
  }

  const document = store.documentsByKey.get(key) ?? createDocumentSession(snapshot);
  applySnapshotToDocument(document, snapshot);
  store.documentsByKey.set(key, document);
  store.activePane.document = document;
  return document;
}

export function syncActiveDocumentSession(
  store: DocumentSessionStore,
  snapshot: SessionSnapshot
) {
  const document = store.activePane.document;
  return syncDocumentSession(store, document, snapshot);
}

export function syncDocumentSession(
  store: DocumentSessionStore,
  document: DocumentSession,
  snapshot: SessionSnapshot,
  { preserveDraft = false }: { preserveDraft?: boolean } = {}
) {
  const previousKey = getDocumentKey(document.currentNoteId, document.currentNotePath);
  const nextKey = getDocumentKey(snapshot.currentNoteId, snapshot.currentNotePath);

  if (previousKey && previousKey !== nextKey) {
    store.documentsByKey.delete(previousKey);
  }

  if (preserveDraft) {
    document.currentNoteId = snapshot.currentNoteId;
    document.currentNotePath = snapshot.currentNotePath;
    document.lastSavedTitle = snapshot.lastSavedTitle;
    document.lastSavedMarkdown = snapshot.lastSavedMarkdown;
    document.lastSavedNoteId = snapshot.lastSavedNoteId;
    document.lastSavedPath = snapshot.lastSavedPath;
  } else {
    applySnapshotToDocument(document, snapshot);
  }

  if (nextKey) {
    store.documentsByKey.set(nextKey, document);
  }

  return document;
}

export function resetActiveDocumentSession(store: DocumentSessionStore) {
  const document = createDocumentSession();
  store.activePane.document = document;
  return document;
}

export function discardDocumentSession(
  store: DocumentSessionStore,
  noteId: string | null,
  notePath: string | null
) {
  const key = getDocumentKey(noteId, notePath);
  if (!key) {
    return;
  }

  store.documentsByKey.delete(key);
}
