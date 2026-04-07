import type { EditorState } from '@milkdown/kit/prose/state';
import {
  createEmptySessionSnapshot,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';

export interface DocumentSession extends SessionSnapshot {
  editorState: EditorState | null;
  editorStateGeneration: number;
  saveTimer: ReturnType<typeof window.setTimeout> | null;
  saveQueue: Promise<void>;
}

export interface DocumentSessionStore {
  activeDocument: DocumentSession;
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
    editorState: null,
    editorStateGeneration: 0,
    saveTimer: null,
    saveQueue: Promise.resolve()
  };
}

export function createDocumentSessionStore(): DocumentSessionStore {
  return {
    activeDocument: createDocumentSession(),
    documentsByKey: new Map<string, DocumentSession>()
  };
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
    store.activeDocument = document;
    return document;
  }

  const document = store.documentsByKey.get(key) ?? createDocumentSession(snapshot);
  applySnapshotToDocument(document, snapshot);
  store.documentsByKey.set(key, document);
  store.activeDocument = document;
  return document;
}

export function syncActiveDocumentSession(
  store: DocumentSessionStore,
  snapshot: SessionSnapshot
) {
  const document = store.activeDocument;
  const previousKey = getDocumentKey(document.currentNoteId, document.currentNotePath);
  const nextKey = getDocumentKey(snapshot.currentNoteId, snapshot.currentNotePath);

  if (previousKey && previousKey !== nextKey) {
    store.documentsByKey.delete(previousKey);
  }

  applySnapshotToDocument(document, snapshot);

  if (nextKey) {
    store.documentsByKey.set(nextKey, document);
  }

  return document;
}

export function resetActiveDocumentSession(store: DocumentSessionStore) {
  const document = createDocumentSession();
  store.activeDocument = document;
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
