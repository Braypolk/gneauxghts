import type { EditorSnapshot } from '$lib/features/notepad/editor/editor';
import type {
  EditorCapabilityAdapter,
  EditorMarkdownInsertOptions,
  EditorMarkdownInsertResult
} from '$lib/features/notepad/editor/editorCapabilities';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  documentToSessionSnapshot
} from '$lib/features/notepad/document/documentState';

export interface NotepadDocumentSnapshot {
  documentHandle: string;
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

export interface NotepadInsertMarkdownRequest extends EditorMarkdownInsertOptions {
  documentHandle: string;
  expectedDocumentRevision: number;
  markdown: string;
}

export type NotepadInsertMarkdownResult =
  | ({ status: 'inserted' } & EditorMarkdownInsertResult)
  | { status: 'target-changed'; currentDocumentHandle: string; currentDocumentRevision: number }
  | { status: 'editor-unavailable' };

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
  insertMarkdown: (request: NotepadInsertMarkdownRequest) => NotepadInsertMarkdownResult;
  focusActiveEditor: (options?: { preferTitle?: boolean }) => void | Promise<void>;
  saveActiveDocument: () => Promise<void>;
  refreshActiveDocument: (options?: { force?: boolean }) => Promise<void>;
  replaceActiveDocumentMarkdown: (markdown: string) => Promise<void>;
}

export function snapshotDocument(document: NoteDraftState): NotepadDocumentSnapshot {
  const snapshot = documentToSessionSnapshot(document);
  return {
    documentHandle: document.handle,
    ...snapshot,
    operationRevision: document.operation.revision
  };
}

export function createNotepadFeatureHost(deps: NotepadFeatureHostDeps): NotepadFeatureHost {
  return {
    getActiveDocumentSnapshot: () => snapshotDocument(deps.getActiveDocument()),
    getActiveEditorSnapshot: () => deps.getActiveEditor()?.readSnapshot() ?? null,
    getActiveSelectionSnapshot: () => deps.getActiveEditor()?.readSelection() ?? null,
    insertMarkdown: ({ documentHandle, expectedDocumentRevision, markdown, ...options }) => {
      const document = deps.getActiveDocument();
      if (
        document.handle !== documentHandle ||
        document.operation.revision !== expectedDocumentRevision
      ) {
        return {
          status: 'target-changed',
          currentDocumentHandle: document.handle,
          currentDocumentRevision: document.operation.revision
        };
      }

      const result = deps.getActiveEditor()?.insertMarkdown(markdown, options) ?? null;
      return result ? { status: 'inserted', ...result } : { status: 'editor-unavailable' };
    },
    focusActiveEditor: deps.focusActiveEditor,
    saveActiveDocument: deps.saveActiveDocument,
    refreshActiveDocument: deps.refreshActiveDocument,
    replaceActiveDocumentMarkdown: deps.replaceActiveDocumentMarkdown
  };
}
