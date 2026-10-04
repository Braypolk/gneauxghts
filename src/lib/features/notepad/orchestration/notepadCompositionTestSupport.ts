import { vi } from 'vitest';
import { WorkspaceStore, type NotepadPaneId } from '../workspace/workspaceStore.svelte';
import { createNotepadState, createNoteDraftState, bindNotepadStateToVault, type NoteDraftState } from '../state/noteStore';
import { createDocumentEditingService } from '../document/documentEditingService';
import { createDocumentPaneCoordinator } from '../document/documentPaneCoordinator';
import { createNotepadPersistenceController } from './persistenceController';
import { createNotepadWorkspaceSession, type NotepadWorkspaceSessionOptions } from './notepadWorkspaceSession';
import { PaneRuntime } from '../pane/paneRuntime.svelte';
import type { PaneEditorLifecycle } from '../pane/paneEditorLifecycle';
import { documentRegistry } from '../document/documentRegistry';
import { createSessionSnapshot, type SessionSnapshot } from '../session/session';
import type { NoteSession } from '../model/types';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function persistedSession(id = 'a', markdown = id): NoteSession {
  return { noteId: id, path: `/vault/${id}.md`, title: id, markdown };
}

/** Real state/persistence/command owners; only rendered editor effects and IO are fake. */
export function createNotepadComposition(initial: SessionSnapshot = createSessionSnapshot(persistedSession())) {
  const previousRuntimes = new Set(documentRegistry.values());
  const first = 'notepad-pane-1' as NotepadPaneId;
  let nextPane = 1;
  const initialDocument = createNoteDraftState(initial);
  const state = createNotepadState<NotepadPaneId>(initialDocument);
  bindNotepadStateToVault(state, '/vault');
  const workspace = new WorkspaceStore(first, initialDocument.handle);
  const runtimes = new Map<NotepadPaneId, PaneRuntime>();
  const getPaneRuntime = (id: NotepadPaneId) => {
    let runtime = runtimes.get(id);
    if (!runtime) { runtime = new PaneRuntime(id); runtimes.set(id, runtime); }
    return runtime;
  };
  const getPaneDocument = (id: NotepadPaneId) => state.documentsByHandle[workspace.getPaneState(id).documentHandle];
  const getPaneKind = (id: NotepadPaneId) => workspace.getPaneState(id).kind;
  const getNavigationPaneId = () => workspace.getNavigationPaneId();
  const getNavigationDocument = () => getPaneDocument(getNavigationPaneId());
  const applied = async () => 'applied' as const;
  const paneLifecycle: PaneEditorLifecycle<NotepadPaneId> = {
    mountPaneEditor: vi.fn(applied), destroyPaneEditor: vi.fn(applied), captureViewState: vi.fn(() => null),
    restoreViewState: vi.fn(applied), saveCursorPosition: vi.fn(applied), replaceContent: vi.fn(applied),
    replaceContentInPlace: vi.fn(applied), bindDocument: vi.fn(applied), ensurePaneEditors: vi.fn(async () => {}),
    disposePane: vi.fn(async () => {}), disposeAll: vi.fn(async () => {})
  };
  const documents = createDocumentPaneCoordinator({
    paneLifecycle, getPaneRuntime, getVisiblePaneIds: () => workspace.paneOrder,
    getPaneIdsForDocument: document => workspace.getPaneIdsForDocument(document.handle), getPaneKind,
    getNavigationDocument, getNavigationPaneId, getPaneDocument,
    getDocumentByHandle: handle => state.documentsByHandle[handle] ?? null
  });
  let isReviewing = (_document: NoteDraftState) => false;
  const editing = createDocumentEditingService<NotepadPaneId>({
    state, isApplyingProgrammaticUpdate: () => false, shouldSuppressAutosave: document => isReviewing(document),
    isTitleEditing: () => false, resetPaneCommandAfterBodyInput: () => {},
    clearRecentlyForgotten: () => { state.recentlyForgotten = null; }, clearSelectedRelatedText: () => {},
    scheduleAutosave: document => persistence.scheduleAutosave(document), scheduleSearch: vi.fn(), scheduleRelated: vi.fn()
  });
  const save = vi.fn(async (title: string, markdown: string, path: string | null): Promise<NoteSession> => ({
    title, markdown, path: path ?? `/vault/${title}.md`, noteId: path?.split('/').pop()?.replace('.md', '') ?? 'new-note'
  }));
  const persistence = createNotepadPersistenceController({
    getDocumentSession: getNavigationDocument, saveNoteSession: save, documentEditing: editing,
    shouldSuppressPersistence: document => isReviewing(document)
  });
  const deps: NotepadWorkspaceSessionOptions = {
    state, workspace, maxVisiblePanes: 3, canSplitWorkspace: () => true,
    presentation: {
      getPaneTitleInput: () => null, closeTransientUiExcept: vi.fn(), waitForPaneMotion: async () => {},
      focusPaneEditor: vi.fn(() => true), focusPaneEditorAtEnd: vi.fn(() => true), focusPaneChat: vi.fn(() => true),
      createPane: () => `notepad-pane-${++nextPane}` as NotepadPaneId,
      disposePaneRuntime: async id => { await paneLifecycle.disposePane(id); runtimes.delete(id); },
      updateSelectedRelatedText: vi.fn(), closeWikilinkAutocomplete: vi.fn()
    },
    persistence, documents, documentEditing: editing, paneLifecycle,
    derivedViews: {
      discoverPendingProposals: vi.fn(),
      clearSearch: vi.fn(), scheduleSearchIfNeeded: vi.fn(), scheduleRelatedIfNeeded: vi.fn(),
      clearSelectedRelatedText: vi.fn(), loadRecentNotes: vi.fn(async () => []),
    },
    forgottenNoteRetentionPreference: () => 7, isReviewingDocument: document => isReviewing(document)
  };
  const commands = createNotepadWorkspaceSession(deps);
  return {
    first, initialDocument, state, workspace, commands, deps, paneLifecycle, editing, persistence, save,
    getPaneDocument, getNavigationDocument, getPaneRuntime,
    setReviewing: (predicate: typeof isReviewing) => { isReviewing = predicate; },
    async dispose() {
      commands.dispose();
      const owned = [...documentRegistry.values()].filter(runtime => !previousRuntimes.has(runtime));
      for (const runtime of owned) runtime.clearSaveTimer();
      await Promise.allSettled(owned.map(runtime => runtime.getSaveQueue()));
      for (const runtime of owned) documentRegistry.dispose(runtime.documentHandle);
      for (const runtime of runtimes.values()) runtime.flushCursorSave();
    }
  };
}
