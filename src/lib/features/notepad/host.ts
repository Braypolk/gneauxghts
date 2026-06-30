import type { EditorSnapshot } from '$lib/features/notepad/editor/editor';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

export interface NotepadDocumentSnapshot {
  key: string;
  title: string;
  bodyMarkdown: string;
  currentNoteId: string | null;
  currentNotePath: string | null;
  lastSavedTitle: string;
  lastSavedMarkdown: string;
  lastSavedNoteId: string | null;
  lastSavedPath: string | null;
  operationRevision: number;
}

export interface NotepadEditorSelectionSnapshot {
  selectedText: string;
  anchor: number;
  head: number;
}

export interface NotepadFeatureHostDeps {
  getActiveDocument: () => NoteDraftState;
  getActiveEditor: () => EditorCapabilityAdapter | null;
  focusActiveEditor: (options?: { preferTitle?: boolean }) => void | Promise<void>;
  saveActiveDocument: () => Promise<void>;
  refreshActiveDocument: (options?: { force?: boolean }) => Promise<void>;
  replaceActiveDocumentMarkdown: (markdown: string) => Promise<void>;
}

export interface NotepadFeatureHost {
  getActiveDocumentSnapshot: () => NotepadDocumentSnapshot;
  getActiveEditorSnapshot: () => EditorSnapshot | null;
  getActiveSelectionSnapshot: () => NotepadEditorSelectionSnapshot | null;
  focusActiveEditor: (options?: { preferTitle?: boolean }) => void | Promise<void>;
  saveActiveDocument: () => Promise<void>;
  refreshActiveDocument: (options?: { force?: boolean }) => Promise<void>;
  replaceActiveDocumentMarkdown: (markdown: string) => Promise<void>;
}

export function snapshotDocument(document: NoteDraftState): NotepadDocumentSnapshot {
  return {
    key: document.key,
    title: document.title,
    bodyMarkdown: document.bodyMarkdown,
    currentNoteId: document.currentNoteId,
    currentNotePath: document.currentNotePath,
    lastSavedTitle: document.lastSavedTitle,
    lastSavedMarkdown: document.lastSavedMarkdown,
    lastSavedNoteId: document.lastSavedNoteId,
    lastSavedPath: document.lastSavedPath,
    operationRevision: document.operationRevision
  };
}

export function createNotepadFeatureHost(deps: NotepadFeatureHostDeps): NotepadFeatureHost {
  return {
    getActiveDocumentSnapshot: () => snapshotDocument(deps.getActiveDocument()),
    getActiveEditorSnapshot: () => deps.getActiveEditor()?.readSnapshot() ?? null,
    getActiveSelectionSnapshot: () => deps.getActiveEditor()?.readSelection() ?? null,
    focusActiveEditor: deps.focusActiveEditor,
    saveActiveDocument: deps.saveActiveDocument,
    refreshActiveDocument: deps.refreshActiveDocument,
    replaceActiveDocumentMarkdown: deps.replaceActiveDocumentMarkdown
  };
}
