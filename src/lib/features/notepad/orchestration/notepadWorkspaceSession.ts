import { tick } from 'svelte';
import type { ForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';
import { finalizeNoteEditingWindow } from '$lib/features/history/historyApi';
import { focusInputAtEnd } from '../navigation/navigation';
import { captureFocusIntent } from '../navigation/focusIntent';
import {
  editorLocationFromRecent,
  loadPersistedChatLocation,
  locationDisplayLabel,
  locationsEqual,
  notepadLocationMru,
  type LocationHistoryEntry,
  type NavLocation
} from '../navigation/locationMru';
import {
  clearLastOpenedNote,
  createForgottenNote,
  forgetNoteSession,
  hasContent,
  openNoteSession,
  readNoteSession,
  restoreForgottenNotes,
  type ForgottenNote
} from '../session/session';
import {
  adoptSnapshotForPane,
  findOpenDocument,
  createFreshDraftNote,
  getPaneNote,
  removeNoteIfUnreferenced,
  replacePaneReferenceWithFreshDraft,
  replaceReferencedNoteWithFreshDraft,
  type NoteDraftState,
  type DocumentHandle,
  type NotepadState
} from '../state/noteStore';
import { documentRegistry } from '../document/documentRegistry';
import { cleanupNoteRuntime } from '../session/noteRuntime';
import {
  dispatchDocumentExternalSync,
  dispatchDocumentOperation,
  documentCanLeaveWithoutCanonicalWrite,
  documentHasCleanBuffer,
  documentHasUnresolvedConflict,
  externalSnapshotMatchesSavedBaseline,
  externalDocumentSnapshotFromCommittedNote,
  getDocumentMarkdown,
  getDocumentNoteId,
  getDocumentPath,
  getDocumentTitle,
  isDocumentOperationCurrent,
  type ExternalRefreshSource
} from '../document/documentState';
import type { DocumentPaneCoordinator } from '../document/documentPaneCoordinator';
import type { DocumentEditingService } from '../document/documentEditingService';
import type { PaneEditorLifecycle } from '../pane/paneEditorLifecycle';
import type { WorkspaceStore, NotepadPaneId } from '../workspace/workspaceStore.svelte';
import type { PaneKind } from '../workspace/paneTypes';
import { canSetPaneKind, paneHasCapability } from '../workspace/paneCapabilities';
import { adoptChatContextFromLeavingEditor } from '../workspace/paneRoles';
import { createPaneCloseAnimation } from '../workspace/paneCloseAnimation';
import {
  getNextPaneCommandIndex,
  getPaneCommandChoiceByIndex,
  getPaneCommandForShortcut,
  type PaneCommandChoice
} from '../paneCommandPicker';
import type { SearchItem } from '$lib/types/semantic';
import type { createNotepadPersistenceController } from './persistenceController';
export type { LocationHistoryEntry, NavLocation } from '../navigation/locationMru';
export interface OpenNoteOptions {
  noteId?: string | null;
  focusEditorAfterOpen?: boolean;
  /** Reveal a retained chat's editor only after the note is loaded. */
  revealEditorAfterOpen?: boolean;
}
/** Rendered effects only: no workspace queries or structural mutations. */
export interface WorkspacePresentation {
  getPaneTitleInput: (paneId: NotepadPaneId) => HTMLInputElement | null;
  focusPaneEditor: (paneId: NotepadPaneId) => boolean;
  focusPaneEditorAtEnd: (paneId: NotepadPaneId) => boolean;
  focusPaneChat: (paneId: NotepadPaneId) => boolean;
  createPane: () => NotepadPaneId;
  disposePaneRuntime: (paneId: NotepadPaneId, document: NoteDraftState | null) => Promise<void>;
  closeTransientUiExcept: (paneId: NotepadPaneId) => void;
  updateSelectedRelatedText: (paneId?: NotepadPaneId) => void;
  closeWikilinkAutocomplete: (paneId?: NotepadPaneId) => void;
  waitForPaneMotion: () => Promise<void>;
}
export interface WorkspaceDerivedViews {
  discoverPendingProposals: (document: NoteDraftState) => void;
  clearSearch: () => void;
  scheduleSearchIfNeeded: () => void;
  scheduleRelatedIfNeeded: (options?: {
    immediate?: boolean;
  }) => void;
  clearSelectedRelatedText: () => void;
  loadRecentNotes: () => Promise<SearchItem[] | null> | SearchItem[] | null;
}
export interface NotepadWorkspaceSessionOptions {
  state: NotepadState<NotepadPaneId>;
  workspace: WorkspaceStore;
  persistence: ReturnType<typeof createNotepadPersistenceController>;
  documentEditing: DocumentEditingService<NotepadPaneId>;
  documents: DocumentPaneCoordinator<NotepadPaneId>;
  paneLifecycle: PaneEditorLifecycle<NotepadPaneId>;
  presentation: WorkspacePresentation;
  derivedViews: WorkspaceDerivedViews;
  maxVisiblePanes: number;
  canSplitWorkspace: () => boolean;
  forgottenNoteRetentionPreference: () => ForgottenNoteRetentionPreference;
  isReviewingDocument?: (document: NoteDraftState) => boolean;
  onNavigationBlocked?: () => void;
}
class SupersededNavigation extends Error {
}
interface Navigation {
  readonly focusIntent: ReturnType<typeof captureFocusIntent>;
  readonly paneId: NotepadPaneId;
  readonly id: number;
  readonly restoring: boolean;
  check(): void;
  depart(): Promise<void>;
  release(): void;
}
/** Owns complete workspace actions; storage, document adoption and rendered editors retain their owners. */
export function createNotepadWorkspaceSession(options: NotepadWorkspaceSessionOptions) {
  const {
    state, workspace, persistence, documentEditing,
    documents, paneLifecycle, presentation, derivedViews
  } = options;
  const locationMru = notepadLocationMru;
  let disposed = false;
  let nextOperationId = 0;
  const activeOperations = new Map<NotepadPaneId, Navigation>();
  let departureTail = Promise.resolve();
  let epoch = 0;
  let epochListener: ((value: number) => void) | null = null;
  const getPaneKind = (paneId: NotepadPaneId) => workspace.getPaneState(paneId).kind;
  const getPaneDocument = (paneId: NotepadPaneId) => getPaneNote(state, workspace, paneId);
  const getNavigationDocument = () => getPaneDocument(workspace.getNavigationPaneId());
  const setPaneDocument = (paneId: NotepadPaneId, document: NoteDraftState) => workspace.setPaneDocumentHandle(paneId, document.handle);
  const canLeaveDocument = (document: NoteDraftState) =>
    !documentHasUnresolvedConflict(document) || documentCanLeaveWithoutCanonicalWrite(document);
  const hasOtherEditor = (paneId: NotepadPaneId, document: NoteDraftState) =>
    workspace.getEditorPaneIds().some(
      id => id !== paneId && getPaneDocument(id).handle === document.handle
    );
  const paneCloseAnimation = createPaneCloseAnimation<NotepadPaneId>({
    beginCollapse: id => workspace.beginPaneCollapse(id),
    endCollapse: id => workspace.endPaneCollapse(id),
    settle: () => tick(),
    waitForMotion: presentation.waitForPaneMotion,
    prefersReducedMotion: () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  });
  // Exactly one admission per public action. Nested destination work shares this context.
  async function navigate(paneId: NotepadPaneId, restoring: boolean, action: (operation: Navigation) => Promise<unknown>) {
    if (disposed) return;
    let releaseDeparture: (() => void) | undefined;
    let acquired = false;
    const operation: Navigation = {
      focusIntent: captureFocusIntent(),
      paneId,
      id: ++nextOperationId,
      restoring,
      check() {
        if (activeOperations.get(paneId) !== operation) {
          throw new SupersededNavigation();
        }
      },
      async depart() {
        if (acquired) {
          return;
        }
        acquired = true;
        const preceding = departureTail;
        departureTail = new Promise<void>(resolve => {
          releaseDeparture = resolve;
        });
        await preceding;
        operation.check();
      },
      release() {
        releaseDeparture?.();
        releaseDeparture = undefined;
      }
    };
    activeOperations.get(paneId)?.focusIntent.dispose();
    activeOperations.set(paneId, operation);
    try {
      await action(operation);
    } catch (error) {
      if (!(error instanceof SupersededNavigation)) {
        throw error;
      }
    } finally {
      operation.focusIntent.dispose();
      operation.release();
      if (activeOperations.get(paneId) === operation) {
        activeOperations.delete(paneId);
      }
      if (restoring) {
        bumpEpoch();
      }
    }
  }

  function activatePaneSession(paneId: NotepadPaneId) {
    workspace.setActivePaneId(paneId);
    presentation.closeTransientUiExcept(paneId);
  }

  function activatePane(paneId: NotepadPaneId) {
    activatePaneSession(paneId);
    presentation.updateSelectedRelatedText(paneId);
    derivedViews.scheduleSearchIfNeeded();
    derivedViews.scheduleRelatedIfNeeded({ immediate: true });
  }

  function focusPaneAfterShortcut(paneId: NotepadPaneId, { preferTitle = false } = {}) {
    const input = presentation.getPaneTitleInput(paneId);
    if (preferTitle && input) {
      return focusInputAtEnd(input);
    }
    if (presentation.focusPaneEditor(paneId) || presentation.focusPaneChat(paneId)) {
      return;
    }
    input?.focus();
  }

  async function focusAfterPresentation(operation: Navigation, preferTitle = false) {
    await tick();
    await presentation.waitForPaneMotion();
    operation.check();
    if (workspace.activePaneId === operation.paneId && operation.focusIntent.isCurrent()) {
      focusPaneAfterShortcut(operation.paneId, { preferTitle });
    }
  }

  function refreshDerivedViews() {
    derivedViews.clearSelectedRelatedText();
    derivedViews.scheduleSearchIfNeeded();
    derivedViews.scheduleRelatedIfNeeded({ immediate: true });
  }

  function releaseDocument(handle: DocumentHandle) {
    const document = state.documentsByHandle[handle];
    if (!document || !documentHasCleanBuffer(document)) {
      return;
    }
    if (removeNoteIfUnreferenced(state, workspace, handle)) {
      cleanupNoteRuntime(handle);
    }
  }

  async function finishReviewDocument(document: NoteDraftState) {
    if (state.documentsByHandle[document.handle] !== document) return;
    persistence.cancelPendingAutosave(document);
    await persistence.getNoteSaveQueue(document.handle);
    if (state.documentsByHandle[document.handle] !== document) return;
    if (!documentHasCleanBuffer(document)) {
      await persistence.enqueueSave(document);
    }
    releaseDocument(document.handle);
  }
  // Saves establish identity before the final cursor/MRU capture. Finalization is deliberately separate
  // from save-only preliminary capture: a picker with no destination must not seal an Editing Window.
  async function prepareDocument(paneId: NotepadPaneId, finalize = true) {
    documents.flushAllPendingCursorSaves();
    persistence.cancelPendingAutosave(getPaneDocument(paneId));
    await persistence.getNoteSaveQueue(getPaneDocument(paneId).handle);
    let document = getPaneDocument(paneId);
    const retainsReview = () => options.isReviewingDocument?.(document) === true && !documentHasUnresolvedConflict(document);
    if (!documentCanLeaveWithoutCanonicalWrite(document) && !retainsReview()) {
      await persistence.enqueueSave(document);
    }
    document = getPaneDocument(paneId);
    if (!documentHasCleanBuffer(document) && !retainsReview()) {
      throw new Error('The note could not be saved before leaving the editor.');
    }
    const noteId = getDocumentNoteId(document);
    if (finalize && noteId && !hasOtherEditor(paneId, document)) {
      await finalizeNoteEditingWindow(noteId);
    }
    await documents.saveCursorPositionForPane(paneId, document);
    return document;
  }
  type RefreshOutcome = 'skipped' | 'stale' | 'unchanged' | 'conflict' | 'refreshed' | 'failed';
  interface RefreshRun {
    promise: Promise<RefreshOutcome>;
    trailingSource: ExternalRefreshSource | null;
  }
  const refreshRuns = new Map<DocumentHandle, RefreshRun>();
  async function runSingleDocumentRefresh(
    note: NoteDraftState,
    source: ExternalRefreshSource
  ): Promise<RefreshOutcome> {
    const currentPath = getDocumentPath(note);
    if (disposed || !currentPath) {
      return 'skipped';
    }
    const baselineAtRead = note.savedBaseline;
    try {
      const session = await readNoteSession(getDocumentNoteId(note), currentPath);
      if (disposed || getDocumentPath(note) !== currentPath ||
        // A save/restore/proposal adoption at the same path supersedes this
        // read. Local edits alone retain the baseline and still become a conflict.
        note.savedBaseline !== baselineAtRead) {
        return 'stale' as const;
      }
      if (externalSnapshotMatchesSavedBaseline(note, session)) {
        return 'unchanged' as const;
      }
      if (!persistence.hasCleanBuffer(note)) {
        persistence.cancelPendingAutosave(note);
        persistence.invalidatePendingSaveResults(note);
        dispatchDocumentExternalSync(note, {
          type: 'externalCaptured',
          external: {
            kind: 'snapshot',
            source,
            document: externalDocumentSnapshotFromCommittedNote(session)
          }
        });
        return 'conflict' as const;
      }
      await documentEditing.adoptCleanExternalRefresh(note, session);
      return 'refreshed' as const;
    } catch (error) {
      console.error('Failed to refresh note from disk:', error);
      return 'failed';
    }
  }

  function refreshDocumentFromDisk(note: NoteDraftState, { source = 'windowFocus' }: {
    source?: ExternalRefreshSource;
  } = {}): Promise<RefreshOutcome> {
    const existingRun = refreshRuns.get(note.handle);
    if (existingRun) {
      // A watcher/focus event that arrives while a read is in flight may
      // represent a newer filesystem state. Coalesce the burst, but always
      // retain one trailing read instead of discarding the event.
      existingRun.trailingSource = source;
      return existingRun.promise;
    }
    const run: RefreshRun = {
      promise: Promise.resolve('skipped'),
      trailingSource: null
    };
    run.promise = (async () => {
      let nextSource: ExternalRefreshSource | null = source;
      let outcome: RefreshOutcome = 'skipped';
      while (nextSource) {
        const currentSource = nextSource;
        run.trailingSource = null;
        outcome = await runSingleDocumentRefresh(note, currentSource);
        nextSource = disposed ? null : run.trailingSource;
      }
      return outcome;
    })().finally(() => {
      if (refreshRuns.get(note.handle) === run) {
        refreshRuns.delete(note.handle);
      }
    });
    refreshRuns.set(note.handle, run);
    return run.promise;
  }

  async function refreshCurrentNoteFromDisk(source: ExternalRefreshSource = 'windowFocus') {
    return refreshDocumentFromDisk(getNavigationDocument(), { source });
  }
  /**
  * Reconciles a successful app-owned proposal write with its open document.
  * The commit's exact editor markdown is the ownership proof: if disk matches
  * it, advance the saved baseline without manufacturing an external conflict.
  * Any local edit made after the commit remains as a dirty working copy.
  */
  async function acknowledgeDocumentCommit(commit: {
    document: NoteDraftState;
    path: string;
    markdown: string;
    commitWarning: CommittedMutationWarning | null;
  }) {
    const { document, path, markdown, commitWarning } = commit;
    // Durable publication outlives the route that requested it. Adopt only into
    // the same retained document, while navigation callbacks remain retired.
    if (state.documentsByHandle[document.handle] !== document) return;
    const snapshot = await readNoteSession(getDocumentNoteId(document), path);
    if (state.documentsByHandle[document.handle] !== document) return;
    if (snapshot.markdown !== markdown) {
      // The file no longer contains the bytes this app committed. Route the
      // mismatch through normal external-change protection instead of claiming
      // ownership of a racing write.
      if (disposed) {
        persistence.cancelPendingAutosave(document);
        persistence.invalidatePendingSaveResults(document);
        dispatchDocumentExternalSync(document, {
          type: 'externalCaptured',
          external: {
            kind: 'snapshot', source: 'watcher',
            document: externalDocumentSnapshotFromCommittedNote(snapshot)
          }
        });
      } else {
        await refreshDocumentFromDisk(document, { source: 'watcher' });
      }
      return;
    }
    persistence.cancelPendingAutosave(document);
    persistence.invalidatePendingSaveResults(document);
    await documentEditing.adoptAcceptedProposal(document, snapshot, markdown, commitWarning);
  }

  function bumpEpoch() {
    epoch += 1;
    epochListener?.(epoch);
  }

  function setLocationHistoryEpochListener(listener: ((value: number) => void) | null) {
    epochListener = listener;
    listener?.(epoch);
  }

  function capturePaneLocation(paneId: NotepadPaneId): NavLocation | null {
    const pane = workspace.getPaneState(paneId);
    const document = getPaneDocument(paneId);
    const noteId = getDocumentNoteId(document);
    const notePath = getDocumentPath(document);
    if (pane.kind === 'chat') {
      return {
        kind: 'chat',
        conversationId: pane.chatConversationId,
        contextNoteId: noteId,
        contextNotePath: notePath
      };
    }
    if (!noteId && !notePath) {
      return null;
    }
    return {
      kind: 'editor',
      noteId,
      notePath
    };
  }

  function canRestoreLocation(paneId: NotepadPaneId, location: NavLocation): boolean {
    if (location.kind === 'editor') {
      return true;
    }
    return canSetPaneKind({
      paneOrder: workspace.paneOrder,
      getPaneKind: getPaneKind
    }, paneId, 'chat');
  }

  function previousRestorableLocation(
    targetPaneId: NotepadPaneId,
    historyPaneId: NotepadPaneId,
    current: NavLocation | null
  ): NavLocation | null {
    for (const entry of locationMru.historyExcluding(historyPaneId, current)) {
      if (canRestoreLocation(targetPaneId, entry.location)) {
        return entry.location;
      }
    }
    return null;
  }

  function blurFocusedPaneTitle(paneId: NotepadPaneId) {
    const input = presentation.getPaneTitleInput(paneId);
    if (input && document.activeElement === input) {
      input.blur();
    }
  }
  /** Keep the thought-partner stack entry pointed at the note now in the editor. */
  function bindChatContextToNote(paneId: NotepadPaneId, noteId: string | null, notePath: string | null) {
    if (locationMru.bindChatContextToNote(paneId, noteId, notePath)) {
      bumpEpoch();
    }
  }

  async function ensureLocationMruSeeded(paneId: NotepadPaneId) {
    if (locationMru.isSeeded(paneId)) {
      return;
    }
    const recentNotes = await derivedViews.loadRecentNotes();
    if (recentNotes === null) {
      return;
    }
    if (locationMru.isSeeded(paneId)) {
      return;
    }
    const seeded = recentNotes
      .map((item) => editorLocationFromRecent({
      noteId: item.noteId,
      notePath: item.notePath
    }))
      .filter((location): location is NavLocation => location !== null);
    const persistedChat = await loadPersistedChatLocation();
    if (persistedChat) {
      seeded.unshift(persistedChat);
    }
    const changed = locationMru.seedMissing(paneId, seeded);
    if (changed) {
      bumpEpoch();
    }
  }

  function findPaneCommandReferencePaneId(targetPaneId: NotepadPaneId): NotepadPaneId {
    if (workspace.paneCommand.mode !== 'split') {
      return targetPaneId;
    }
    const sourcePaneId = workspace.paneCommand.sourcePaneId;
    if (sourcePaneId &&
      sourcePaneId !== targetPaneId &&
      workspace.paneOrder.includes(sourcePaneId)) {
      return sourcePaneId;
    }
    return (workspace.paneOrder.find((paneId) => paneId !== targetPaneId) ??
      targetPaneId);
  }

  async function resolvePreviousLocationForPaneCommand(targetPaneId: NotepadPaneId) {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    await ensureLocationMruSeeded(referencePaneId);
    return previousRestorableLocation(targetPaneId, referencePaneId, capturePaneLocation(referencePaneId));
  }

  function peekPreviousLocationForPaneCommand(targetPaneId: NotepadPaneId) {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    return previousRestorableLocation(targetPaneId, referencePaneId, capturePaneLocation(referencePaneId));
  }

  function paneCommandPreviousLocationLabel(targetPaneId: NotepadPaneId) {
    const previous = peekPreviousLocationForPaneCommand(targetPaneId);
    return previous ? locationDisplayLabel(previous) : null;
  }

  function paneCommandCurrentLocationLabel(targetPaneId: NotepadPaneId) {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    const current = capturePaneLocation(referencePaneId);
    return current ? locationDisplayLabel(current) : 'Untitled note';
  }

  function peekLocationHistory(paneId = workspace.activePaneId): LocationHistoryEntry[] {
    return locationMru.historyExcluding(paneId, capturePaneLocation(paneId));
  }

  async function listLocationHistory(paneId = workspace.activePaneId): Promise<LocationHistoryEntry[]> {
    const current = capturePaneLocation(paneId);
    await ensureLocationMruSeeded(paneId);
    const settled = capturePaneLocation(paneId) ?? current;
    return locationMru.historyExcluding(paneId, settled);
  }

  function removeLocation(location: NavLocation) {
    locationMru.remove(location);
    bumpEpoch();
  }

  function adoptClosedLocation(
    paneId: NotepadPaneId,
    remainingPaneId: NotepadPaneId,
    location: NavLocation | null
  ) {
    locationMru.adoptClosedLocation(paneId, remainingPaneId, location);
    bumpEpoch();
  }

  function touchLocation(paneId: NotepadPaneId, location: NavLocation | null) {
    // Mounted chat notifications are feedback, not a second navigation command.
    if (!location || [...activeOperations.values()].some(operation => operation.restoring)) {
      return;
    }
    locationMru.touch(paneId, location);
    bumpEpoch();
  }

  function touchCurrentLocation(paneId = workspace.activePaneId) {
    touchLocation(paneId, capturePaneLocation(paneId));
  }

  async function presentDocument(
    operation: Navigation,
    previous: NoteDraftState,
    next: NoteDraftState,
    focus: boolean
  ) {
    await paneLifecycle.ensurePaneEditors();
    operation.check();
    if (paneHasCapability(getPaneKind(operation.paneId), 'edit-document')) {
      await documents.replacePaneDocument(operation.paneId, previous, next, { restoreCursor: true });
      operation.check();
      bindChatContextToNote(operation.paneId, getDocumentNoteId(next), getDocumentPath(next));
    }
    presentation.updateSelectedRelatedText();
    derivedViews.discoverPendingProposals(next);
    releaseDocument(previous.handle);
    derivedViews.scheduleRelatedIfNeeded({ immediate: true });
    if (!operation.restoring) {
      bumpEpoch();
    }
    if (focus) {
      await focusAfterPresentation(operation);
    }
  }

  async function openDestination(
    operation: Navigation,
    notePath: string | null,
    open: OpenNoteOptions,
    finalKind?: PaneKind
  ) {
    const { paneId } = operation;
    if (!open.noteId && !notePath) {
      return false;
    }
    await operation.depart();
    const current = getPaneDocument(paneId);
    if (getDocumentPath(current) !== notePath && !canLeaveDocument(current)) {
      options.onNavigationBlocked?.();
      return false;
    }
    const previous = await prepareDocument(paneId);
    operation.check();
    const location = capturePaneLocation(paneId);
    const target: NavLocation = {
      kind: 'editor', noteId: open.noteId ?? null, notePath
    };
    if (!operation.restoring && location && !locationsEqual(location, target)) {
      touchLocation(paneId, location);
    }
    const kind = finalKind ?? (
      paneHasCapability(getPaneKind(paneId), 'host-chat') && (!operation.restoring || open.revealEditorAfterOpen)
        ? 'editor'
        : getPaneKind(paneId)
    );
    const snapshot = await openNoteSession(open.noteId ?? null, notePath);
    operation.check();
    workspace.resetPaneCommand();
    const next = adoptSnapshotForPane(state, workspace, paneId, snapshot);
    state.recentlyForgotten = null;
    presentation.closeWikilinkAutocomplete(paneId);
    derivedViews.clearSelectedRelatedText();
    if (kind !== getPaneKind(paneId) && !workspace.setPaneKind(paneId, kind)) {
      throw new Error('Workspace rejected the note destination.');
    }
    workspace.assertInvariants();
    operation.release();
    await presentDocument(operation, previous, next, (open.focusEditorAfterOpen ?? true) && kind === 'editor');
    return true;
  }

  async function presentReviewDocument(target: {
    document: NoteDraftState | null;
    noteId: string | null;
    path: string;
  }): Promise<NoteDraftState | null> {
    if (disposed) return null;
    let retained = target.document ?? findOpenDocument(state, target);
    const matchingPane = retained
      ? workspace.getPaneIdsForDocument(retained.handle).find(
          id => paneHasCapability(getPaneKind(id), 'edit-document')
        )
      : null;
    const mayCreate = () => options.canSplitWorkspace() &&
      workspace.paneOrder.length < options.maxVisiblePanes;
    const createTargetPane = !matchingPane &&
      mayCreate() && (workspace.getEditorPaneIds().length === 0 ||
        Boolean(retained && documentRegistry.isReviewing(retained.handle)));
    const paneId = matchingPane ?? (createTargetPane
      ? presentation.createPane()
      : workspace.getNavigationPaneId());
    let result: NoteDraftState | null = null;
    let targetCreated = false;
    try {
      await navigate(paneId, false, async operation => {
        await operation.depart();
        // Admission can wait behind another pane's save; capacity and membership
        // belong to the workspace at this point, not the earlier target choice.
        if (createTargetPane ? !mayCreate() : !workspace.paneOrder.includes(paneId)) {
          return;
        }
        if (retained && !state.documentsByHandle[retained.handle]) {
          retained = null;
        }
        if (createTargetPane) {
          const initial = retained ?? createFreshDraftNote(state);
          workspace.dispatchPaneMembership(paneId, {
            type: 'createRequested', operationId: operation.id
          });
          workspace.completePaneCreation(paneId, operation.id, initial.handle, 'editor');
          targetCreated = true;
        }
        activatePaneSession(paneId);
        const previous = getPaneDocument(paneId);
        if (!retained) {
          const opened = await openDestination(operation, target.path, {
            noteId: target.noteId, focusEditorAfterOpen: false
          }, 'editor');
          if (!opened) return;
        } else {
          if (previous.handle !== retained.handle) {
            if (!canLeaveDocument(previous)) {
              options.onNavigationBlocked?.();
              return;
            }
            await prepareDocument(paneId);
            operation.check();
            touchCurrentLocation(paneId);
            setPaneDocument(paneId, retained);
          }
          if (!workspace.setPaneKind(paneId, 'editor')) {
            throw new Error('Workspace rejected the review editor.');
          }
          workspace.resetPaneCommand();
          operation.release();
          await presentDocument(operation, previous, retained, false);
        }
        operation.check();
        if (workspace.activePaneId !== paneId) return;
        // Explicit review preserves a chat surface beside a lone editor, while
        // passive proposal arrival never calls this presentation operation.
        if (workspace.paneOrder.length === 1 && mayCreate()) {
          const chatPaneId = presentation.createPane();
          workspace.dispatchPaneMembership(chatPaneId, {
            type: 'createRequested', operationId: operation.id
          });
          workspace.completePaneCreation(
            chatPaneId, operation.id, getPaneDocument(paneId).handle, 'chat'
          );
        }
        await paneLifecycle.ensurePaneEditors();
        operation.check();
        await focusAfterPresentation(operation);
        if (workspace.activePaneId === paneId) result = getPaneDocument(paneId);
      });
    } finally {
      if (createTargetPane && !targetCreated) {
        await presentation.disposePaneRuntime(paneId, null);
      }
    }

    return result;
  }

  async function reloadReviewDocument(document: NoteDraftState) {
    const path = getDocumentPath(document);
    if (disposed || !path) throw new Error('The reviewed note is no longer available.');
    persistence.cancelPendingAutosave(document);
    await persistence.getNoteSaveQueue(document.handle);
    const revision = document.operation.revision;
    const snapshot = await readNoteSession(getDocumentNoteId(document), path);
    if (disposed || getDocumentPath(document) !== path || document.operation.revision !== revision) {
      throw new Error('The reviewed note changed while loading from disk. Try Reload Disk again.');
    }
    persistence.invalidatePendingSaveResults(document);
    await documentEditing.adoptCleanExternalRefresh(document, snapshot);
  }

  function dispose() {
    disposed = true;
    for (const operation of activeOperations.values()) operation.focusIntent.dispose();
    activeOperations.clear();
    epochListener = null;
  }

  async function openNotePath(notePath: string | null, open: OpenNoteOptions = {}) {
    const paneId = workspace.getNavigationPaneId();
    blurFocusedPaneTitle(paneId);
    await navigate(paneId, false, operation => {
      activatePaneSession(paneId);
      return openDestination(operation, notePath, open);
    });
  }

  async function changeKind(operation: Navigation, kind: PaneKind, recordLocation = true) {
    const { paneId } = operation;
    if (getPaneKind(paneId) === kind) {
      return;
    }
    await operation.depart();
    if (!canSetPaneKind({ paneOrder: workspace.paneOrder, getPaneKind }, paneId, kind)) {
      return;
    }
    let document = getPaneDocument(paneId);
    if (kind === 'chat') {
      if (!canLeaveDocument(document) && !hasOtherEditor(paneId, document)) {
        options.onNavigationBlocked?.();
        return;
      }
      document = await prepareDocument(paneId);
      operation.check();
      adoptChatContextFromLeavingEditor(workspace.paneOrder, getPaneKind, paneId, document, setPaneDocument);
    }
    if (recordLocation) {
      touchCurrentLocation(paneId);
    }
    if (!workspace.setPaneKind(paneId, kind)) {
      throw new Error('Workspace rejected an allowed pane-kind transition.');
    }
    activatePaneSession(paneId);
    operation.release();
    await paneLifecycle.ensurePaneEditors();
    operation.check();
    if (kind === 'chat' && recordLocation) {
      touchCurrentLocation(paneId);
    }
    presentation.updateSelectedRelatedText();
    bumpEpoch();
    await focusAfterPresentation(operation);
  }

  async function setPaneKind(paneId: NotepadPaneId, kind: PaneKind) {
    if (!workspace.paneOrder.includes(paneId)) {
      return;
    }
    await navigate(paneId, false, operation => changeKind(operation, kind));
  }

  async function restoreDestination(operation: Navigation, location: NavLocation) {
    const { paneId } = operation;
    if (!canRestoreLocation(paneId, location)) {
      return;
    }
    activatePaneSession(paneId);
    if (location.kind === 'editor') {
      await openDestination(operation, location.notePath, {
        noteId: location.noteId, focusEditorAfterOpen: true, revealEditorAfterOpen: true
      }, 'editor');
      return;
    }
    const document = getPaneDocument(paneId);
    const hasContext = location.contextNoteId || location.contextNotePath;
    const differentContext = getDocumentNoteId(document) !== location.contextNoteId ||
      getDocumentPath(document) !== location.contextNotePath;
    if (hasContext && differentContext) {
      const opened = await openDestination(operation, location.contextNotePath, {
        noteId: location.contextNoteId, focusEditorAfterOpen: false
      }, 'chat');
      if (!opened) {
        return;
      }
    } else {
      await changeKind(operation, 'chat', false);
    }
    operation.check();
    if (!paneHasCapability(getPaneKind(paneId), 'host-chat')) {
      return;
    }
    locationMru.rememberChat(paneId, location);
    workspace.setPaneConversationId(paneId, location.conversationId);
    presentation.updateSelectedRelatedText();
    await focusAfterPresentation(operation);
  }

  async function previousDestination(operation: Navigation) {
    const { paneId } = operation;
    blurFocusedPaneTitle(paneId);
    await operation.depart();
    if (!capturePaneLocation(paneId) && paneHasCapability(getPaneKind(paneId), 'edit-document')) {
      const document = getPaneDocument(paneId);
      if (document.working.title.trim() || document.working.markdown.trim()) {
        await prepareDocument(paneId, false);
      }
      operation.check();
    }
    const current = capturePaneLocation(paneId);
    await ensureLocationMruSeeded(paneId);
    operation.check();
    let previous = previousRestorableLocation(paneId, paneId, current);
    if (!previous) {
      if (paneHasCapability(getPaneKind(paneId), 'host-chat')) {
        await changeKind(operation, 'editor', false);
      }
      return;
    }
    if (current) {
      locationMru.touch(paneId, current);
      bumpEpoch();
    }
    while (previous) {
      try {
        await restoreDestination(operation, previous);
        return;
      } catch (error) {
        if (previous.kind !== 'editor' || !(error instanceof Error) || error.message !== 'Missing note path') {
          throw error;
        }
        removeLocation(previous);
        previous = previousRestorableLocation(paneId, paneId, current);
      }
    }
  }

  async function goToPreviousLocation(paneId = workspace.activePaneId) {
    await navigate(paneId, true, previousDestination);
  }

  async function openLocationFromHistory(location: NavLocation) {
    const paneId = workspace.activePaneId;
    const current = capturePaneLocation(paneId);
    if (!canRestoreLocation(paneId, location) || (current && locationsEqual(current, location))) {
      return;
    }
    touchLocation(paneId, current);
    await navigate(paneId, true, operation => restoreDestination(operation, location));
  }

  async function splitWorkspace(initialKind: PaneKind = 'editor') {
    if (workspace.paneOrder.length >= options.maxVisiblePanes) {
      await switchActivePane();
      return;
    }
    const sourcePaneId = workspace.activePaneId;
    const source = getPaneDocument(sourcePaneId);
    const paneId = presentation.createPane();
    await navigate(paneId, false, async (operation) => {
      let created = false;
      try {
        if (!workspace.dispatchPaneMembership(paneId, { type: 'createRequested', operationId: operation.id })) {
          throw new Error('Pane creation could not start.');
        }
        await derivedViews.loadRecentNotes();
        await ensureLocationMruSeeded(sourcePaneId);
        operation.check();
        // Other splits can finish while these lookups are pending. Admit the
        // new membership against current capacity, before creating its draft.
        if (workspace.paneOrder.length >= options.maxVisiblePanes) {
          return;
        }
        const document = initialKind === 'chat' ? source : createFreshDraftNote(state);
        workspace.completePaneCreation(paneId, operation.id, document.handle, initialKind);
        created = true;
        if (initialKind === 'chat') {
          workspace.resetPaneCommand();
          touchLocation(paneId, {
            kind: 'editor', noteId: getDocumentNoteId(source), notePath: getDocumentPath(source)
          });
          activatePane(paneId);
        }
        else {
          workspace.beginPaneCommand(paneId, source.handle, 'split', sourcePaneId);
          activatePaneSession(paneId);
          await paneLifecycle.ensurePaneEditors();
          operation.check();
          presentation.updateSelectedRelatedText(paneId);
        }
        if (workspace.activePaneId !== paneId) {
          return;
        }
        if (initialKind === 'chat') {
          await focusAfterPresentation(operation);
        }
        else {
          presentation.focusPaneEditorAtEnd(paneId);
        }
      } finally {
        if (!created) {
          const membership = workspace.getPaneMembership(paneId);
          if (membership.kind === 'creating' && membership.operationId === operation.id) {
            workspace.dispatchPaneMembership(paneId, { type: 'creationFailed', operationId: operation.id });
            await presentation.disposePaneRuntime(paneId, null);
          }
        }
      }
    });
  }

  async function closePane(paneId: NotepadPaneId) {
    if (!workspace.paneOrder.includes(paneId)) {
      return;
    }
    await navigate(paneId, false, async (operation) => {
      await operation.depart();
      if (workspace.getPaneMembership(paneId).kind !== 'ready') {
        return;
      }
      workspace.dispatchPaneMembership(paneId, { type: 'closeRequested', operationId: operation.id });
      if (workspace.getPaneMembership(paneId).kind !== 'closing') {
        return;
      }
      let removed = false;
      let document = getPaneDocument(paneId);
      try {
        if (!workspace.canRemovePane(paneId)) {
          return;
        }
        if (paneHasCapability(getPaneKind(paneId), 'edit-document') && !canLeaveDocument(document) && !hasOtherEditor(paneId, document)) {
          options.onNavigationBlocked?.();
          return;
        }
        const hadCollision = document.canonicalCollision !== null;
        document = await prepareDocument(paneId);
        operation.check();
        const location = capturePaneLocation(paneId);
        await paneCloseAnimation.collapse(paneId);
        operation.check();
        if (workspace.paneCommand.paneId === paneId) {
          workspace.resetPaneCommand();
        }
        adoptChatContextFromLeavingEditor(workspace.paneOrder, getPaneKind, paneId, document, setPaneDocument);
        if (!workspace.retirePane(paneId, operation.id)) {
          throw new Error('Pane became unavailable before close.');
        }
        removed = true;
        const remaining = workspace.activePaneId;
        operation.release();
        // Rendering teardown still reads the retired record; release it only after the view settles.
        try {
          await tick();
          await presentation.disposePaneRuntime(paneId, document);
        }
        finally {
          workspace.completePaneDisposal(paneId, operation.id);
        }
        if (hadCollision) {
          releaseDocument(document.handle);
        }
        operation.check();
        if (workspace.activePaneId !== remaining) {
          return;
        }
        adoptClosedLocation(paneId, remaining, location);
        activatePaneSession(remaining);
        presentation.updateSelectedRelatedText();
        await tick();
        operation.check();
        if (workspace.activePaneId === remaining) {
          focusPaneAfterShortcut(remaining);
        }
      } finally {
        if (!removed) {
          workspace.dispatchPaneMembership(paneId, { type: 'closeBlocked', operationId: operation.id });
        }
        paneCloseAnimation.release(paneId);
      }
    });
  }

  async function switchActivePane(direction: 1 | -1 = 1) {
    const source = workspace.activePaneId;
    const target = workspace.getNextPaneId(source, direction);
    if (!target) {
      return;
    }
    const preferTitle = document.activeElement === presentation.getPaneTitleInput(source);
    await navigate(target, false, async (operation) => {
      activatePane(target);
      await focusAfterPresentation(operation, preferTitle);
    });
  }

  async function handleNotepadCommandBarCommand(command: string): Promise<boolean> {
    const text = command.trim().toLowerCase();
    if (text !== '/chat' && text !== '/edit') {
      return false;
    }
    derivedViews.clearSearch();
    await setPaneKind(workspace.activePaneId, text === '/chat' ? 'chat' : 'editor');
    return true;
  }

  async function openStartPaneCommand(operation: Navigation, documentHandle: DocumentHandle) {
    await derivedViews.loadRecentNotes();
    await ensureLocationMruSeeded(operation.paneId);
    operation.check();
    workspace.beginPaneCommand(operation.paneId, documentHandle, 'start');
    activatePaneSession(operation.paneId);
    operation.release();
    await paneLifecycle.ensurePaneEditors();
    operation.check();
    presentation.updateSelectedRelatedText(operation.paneId);
    if (workspace.activePaneId === operation.paneId) {
      presentation.focusPaneEditorAtEnd(operation.paneId);
    }
  }

  async function startNewNoteFlow() {
    const paneId = workspace.activePaneId;
    blurFocusedPaneTitle(paneId);
    await navigate(paneId, false, async (operation) => {
      await operation.depart();
      const previous = getPaneDocument(paneId);
      const hasCurrentContent = hasContent({
        title: getDocumentTitle(previous), bodyMarkdown: getDocumentMarkdown(previous),
        tags: previous.working.tags,
        tagsError: previous.working.tagsError,
        currentNoteId: getDocumentNoteId(previous),
        currentNotePath: getDocumentPath(previous)
      });
      if (!hasCurrentContent) {
        if (paneHasCapability(getPaneKind(paneId), 'host-chat')) {
          await changeKind(operation, 'editor');
        }
        await openStartPaneCommand(operation, previous.handle);
        return;
      }
      if (!canLeaveDocument(previous)) {
        options.onNavigationBlocked?.();
        return;
      }
      const saved = await prepareDocument(paneId);
      operation.check();
      await clearLastOpenedNote();
      operation.check();
      if (!getDocumentPath(saved)) {
        throw new Error('Document departure completed without a persisted note path.');
      }
      touchCurrentLocation(paneId);
      const draft = replacePaneReferenceWithFreshDraft(state, workspace, paneId);
      if (paneHasCapability(getPaneKind(paneId), 'host-chat') && !workspace.setPaneKind(paneId, 'editor')) {
        throw new Error('Workspace rejected the new-note editor transition.');
      }
      operation.release();
      await paneLifecycle.ensurePaneEditors();
      operation.check();
      await documents.replacePaneDocument(paneId, saved, draft);
      operation.check();
      releaseDocument(saved.handle);
      state.recentlyForgotten = null;
      derivedViews.clearSearch();
      refreshDerivedViews();
      await openStartPaneCommand(operation, draft.handle);
    });
  }

  async function resolvePaneCommandChoice(paneId: NotepadPaneId, choice: PaneCommandChoice) {
    if (workspace.paneCommand.paneId !== paneId) {
      return;
    }
    await navigate(paneId, choice === 'previous', async (operation) => {
      const sourceKey = workspace.paneCommand.sourceDocumentHandle;
      const source = sourceKey ? state.documentsByHandle[sourceKey] : null;
      const reference = findPaneCommandReferencePaneId(paneId);
      const current = workspace.paneCommand.mode === 'split' ? capturePaneLocation(reference) : null;
      const previous = choice === 'previous' ? await resolvePreviousLocationForPaneCommand(paneId) : null;
      operation.check();
      if (workspace.paneCommand.paneId !== paneId || (choice === 'previous' && !previous)) {
        return;
      }
      if (choice === 'current' && current?.kind !== 'chat' && !source) {
        return;
      }
      const placeholder = getPaneDocument(paneId);
      workspace.resetPaneCommand();
      activatePaneSession(paneId);
      if (choice === 'previous') {
        if (reference === paneId) {
          await previousDestination(operation);
        }
        else if (previous) {
          await restoreDestination(operation, previous);
        }
      } else if (choice === 'current' && current?.kind === 'chat') {
        await restoreDestination(operation, current);
        touchLocation(paneId, current);
      } else if (choice !== 'typing') {
        touchLocation(paneId, source ? {
          kind: 'editor', noteId: getDocumentNoteId(source), notePath: getDocumentPath(source)
        } : capturePaneLocation(paneId));
        const kind = choice === 'current' ? 'editor' : 'chat';
        if (!workspace.setPaneKind(paneId, kind)) {
          throw new Error('Workspace rejected the pane-command destination.');
        }
        if (source) {
          setPaneDocument(paneId, source);
        }
        if (choice === 'current' && source) {
          await documents.replacePaneDocument(paneId, placeholder, source, { restoreCursor: true });
          operation.check();
          derivedViews.discoverPendingProposals(source);
        }
        if (placeholder.handle !== sourceKey) {
          releaseDocument(placeholder.handle);
        }
      }
      operation.release();
      await paneLifecycle.ensurePaneEditors();
      operation.check();
      presentation.updateSelectedRelatedText(paneId);
      derivedViews.scheduleSearchIfNeeded();
      derivedViews.scheduleRelatedIfNeeded({ immediate: true });
      if (choice !== 'previous') {
        await tick();
        operation.check();
        if (workspace.activePaneId !== paneId) {
          return;
        }
        if (choice === 'typing') {
          presentation.focusPaneEditorAtEnd(paneId);
        }
        else {
          focusPaneAfterShortcut(paneId);
        }
      }
    });
  }

  function movePaneCommandHighlight(direction: 1 | -1) {
    const paneId = workspace.paneCommand.paneId;
    workspace.setPaneCommandHighlight(getNextPaneCommandIndex(
      workspace.paneCommand.highlightedIndex,
      direction,
      paneId !== null && peekPreviousLocationForPaneCommand(paneId) !== null,
      workspace.paneCommand.mode
    ));
  }

  async function confirmPaneCommandChoiceByHighlight() {
    const paneId = workspace.paneCommand.paneId;
    if (!paneId) {
      return;
    }
    const choice = getPaneCommandChoiceByIndex(
      workspace.paneCommand.highlightedIndex,
      peekPreviousLocationForPaneCommand(paneId) !== null,
      workspace.paneCommand.mode
    );
    if (choice) {
      await resolvePaneCommandChoice(paneId, choice);
    }
  }

  function handlePaneCommandGlobalKeydown(event: KeyboardEvent): boolean {
    const paneId = workspace.paneCommand.paneId;
    if (paneId === null || workspace.activePaneId !== paneId || event.repeat) {
      return false;
    }
    const target = event.target;
    if (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement &&
        target.closest('[data-notepad-command-bar]'))) {
      return false;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      movePaneCommandHighlight(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmPaneCommandChoiceByHighlight();
      return true;
    }
    const choice = getPaneCommandForShortcut(event.key, peekPreviousLocationForPaneCommand(paneId) !== null, workspace.paneCommand.mode);
    if (choice === null) {
      if (event.key.length === 1 ||
        event.key === 'Backspace' ||
        event.key === 'Delete') {
        workspace.resetPaneCommand();
      }
      return false;
    }
    event.preventDefault();
    void resolvePaneCommandChoice(paneId, choice);
    return true;
  }

  async function clearNotepad(request: {
    canRestore?: boolean;
  } = {}) {
    const canRestore = request.canRestore ?? true;
    const paneId = workspace.getNavigationPaneId();
    blurFocusedPaneTitle(paneId);
    const note = getNavigationDocument();
    if (canLeaveDocument(note) === false) {
      options.onNavigationBlocked?.();
      return;
    }
    const notePathToClear = getDocumentPath(note);
    if (notePathToClear) {
      documents.saveCursorPositionForDocument(note);
      persistence.cancelPendingAutosave(note);
      await persistence.enqueueSave(note);
    }
    const draft = {
      title: getDocumentTitle(note),
      bodyMarkdown: getDocumentMarkdown(note),
      ...(note.working.tags ? { tags: [...note.working.tags] } : {}),
      ...(note.working.tagsError ? { tagsError: note.working.tagsError } : {}),
      currentNoteId: getDocumentNoteId(note),
      currentNotePath: getDocumentPath(note)
    };
    const hasDraftContent = hasContent(draft);
    let forgottenPath: string | null = null;
    let lifecycleWarning: CommittedMutationWarning | null = null;
    if (notePathToClear) {
      dispatchDocumentOperation(note, {
        type: 'start',
        operation: 'forgetting'
      });
      const operationToken = note.operation.token;
      try {
        const summary = await forgetNoteSession(notePathToClear, options.forgottenNoteRetentionPreference());
        if (summary?.commitWarning) {
          console.warn('Note was forgotten with incomplete timeline synchronization:', summary.commitWarning);
          lifecycleWarning = summary.commitWarning;
        }
        if (!isDocumentOperationCurrent(note, operationToken)) {
          return;
        }
        forgottenPath = summary?.forgottenPath ?? null;
      } catch (error) {
        console.error('Failed to forget note:', error);
        dispatchDocumentOperation(note, {
          type: 'fail',
          error,
          token: operationToken
        });
        return;
      }
      dispatchDocumentOperation(note, {
        type: 'succeed',
        token: operationToken
      });
      removeLocation({
        kind: 'editor',
        noteId: draft.currentNoteId,
        notePath: notePathToClear
      });
    }
    persistence.invalidatePendingSaveResults(note);
    persistence.cancelPendingAutosave(note);
    const freshDraft = replaceReferencedNoteWithFreshDraft(state, workspace, note.handle);
    freshDraft.publication.warning = lifecycleWarning;
    cleanupNoteRuntime(note.handle);
    setRecentlyForgotten(canRestore && hasDraftContent
      ? createForgottenNote(draft, forgottenPath)
      : null);
    await documents.replaceNoteAcrossPanes(note, freshDraft);
    refreshDerivedViews();
    await navigate(paneId, false, operation => openStartPaneCommand(operation, freshDraft.handle));
  }

  async function unforgetNotepad() {
    const forgottenNote = state.recentlyForgotten;
    if (!forgottenNote) {
      return;
    }
    workspace.resetPaneCommand();
    if (forgottenNote.forgottenPath) {
      try {
        const restoredNotes = await restoreForgottenNotes([
          forgottenNote.forgottenPath
        ]);
        if (restoredNotes[0]?.commitWarning) {
          console.warn('Note was recovered with incomplete timeline synchronization:', restoredNotes[0].commitWarning);
        }
        const restoredPath = restoredNotes[0]?.restoredPath;
        if (!restoredPath) {
          return;
        }
        await openNotePath(restoredPath);
        if (restoredNotes[0]?.commitWarning) {
          getNavigationDocument().publication.warning =
            restoredNotes[0].commitWarning;
        }
        return;
      } catch (error) {
        console.error('Failed to restore forgotten note:', error);
        return;
      }
    }
    const note = getNavigationDocument();
    documentEditing.restoreTransientForgotten(note, forgottenNote);
    void derivedViews.loadRecentNotes();
  }

  function setRecentlyForgotten(value: ForgottenNote | null) {
    state.recentlyForgotten = value;
  }
  return {
    dispose,
    presentReviewDocument,
    reloadReviewDocument,
    activatePane,
    focusPaneAfterShortcut,
    splitWorkspace,
    closePane,
    setPaneKind,
    switchActivePane,
    handleNotepadCommandBarCommand,
    openNotePath,
    startNewNoteFlow,
    clearNotepad,
    unforgetNotepad,
    refreshCurrentNoteIfChanged: () => refreshCurrentNoteFromDisk('windowFocus'),
    refreshCurrentNoteFromTaskMutation: () => refreshCurrentNoteFromDisk('taskMutation'),
    refreshDocumentFromDisk,
    acknowledgeDocumentCommit,
    touchCurrentLocation,
    goToPreviousLocation,
    openLocationFromHistory,
    listLocationHistory,
    peekLocationHistory,
    paneCommandCurrentLocationLabel,
    paneCommandPreviousLocationLabel,
    peekPreviousLocationForPaneCommand,
    resolvePreviousLocationForPaneCommand,
    ensureLocationMruSeeded,
    setLocationHistoryEpochListener,
    movePaneCommandHighlight,
    resolvePaneCommandChoice,
    confirmPaneCommandChoiceByHighlight,
    handlePaneCommandGlobalKeydown,
    finishReviewDocument
  };
}
export type NotepadWorkspaceSession = ReturnType<typeof createNotepadWorkspaceSession>;
