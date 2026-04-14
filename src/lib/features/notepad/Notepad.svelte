<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { Columns2, X } from 'lucide-svelte';
  import { onMount, tick, untrack } from 'svelte';
  import {
    cleanUpApplyPolicyPreference,
    defaultRememberActionPreference,
    forgottenNoteRetentionPreference,
    rememberActionOptions
  } from '$lib/appSettings';
  import {
    EXACT_REMEMBER_ACTION,
    rememberActionRequiresIntegrateSupport,
    type RememberActionOption
  } from '$lib/types/ai';
  import type {
    RelatedNoteItem,
    RelatedNotesResponse,
    SearchItem,
    SemanticStatus
  } from '$lib/types/semantic';
  import type { EditorState } from 'prosemirror-state';
  import type { EditorView } from 'prosemirror-view';
  import type { EditorController } from '$lib/features/notepad/editor/editor';
  import {
    createSharedEditorResources,
    readEditorState,
    setEditorCurrentSearchHighlightQuery
  } from '$lib/features/notepad/editor/editor';
  import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
  import { focusEditorAtEnd, focusInputAtEnd } from '$lib/features/notepad/navigation/navigation';
  import { registerPendingNoteSaveHandler } from '$lib/features/notepad/navigation/pendingNoteSave';
  import {
    navigateToPendingTaskTarget,
    openRecentTask,
    openResolvedNoteLink,
    openSearchResult,
    type NavigationContext,
    type OpenContext
  } from '$lib/features/notepad/navigation/openFlow';
  import { type SearchMode } from '$lib/features/notepad/search/search';
  import {
    createEmptySessionSnapshot,
    createForgottenNote,
    forgetNoteSession,
    hasContent,
    loadCurrentVaultInfo,
    loadSavedNoteSession,
    openNoteSession,
    readNoteSession,
    rememberWithAction,
    resolveAssetRootPath,
    restoreForgottenNotes,
    saveNoteSession,
    shouldSkipAutosave,
    storePastedImageAsset,
    type ForgottenNote,
    type SessionSnapshot
  } from '$lib/features/notepad/session/session';
  import {
    createWikilinkAutocompleteState,
    type WikilinkAutocompleteState
  } from '$lib/features/notepad/wikilinks/state';
  import type { RecentTaskItem } from '$lib/features/notepad/model/types';
  import BottomBar from '$lib/features/notepad/ui/BottomBar.svelte';
  import SplitPaneContentPicker from '$lib/features/notepad/SplitPaneContentPicker.svelte';
  import SlashMenu, {
    type PaneSlashMenuModel
  } from '$lib/features/notepad/editor/SlashMenu.svelte';
  import WikilinkAutocomplete from '$lib/features/notepad/wikilinks/WikilinkAutocomplete.svelte';
  import RelatedPanel from '$lib/features/notepad/related/RelatedPanel.svelte';
  import {
    applySelectedHunks,
    type ReviewUpdateChange
  } from '$lib/features/inbox/reviewDiff';
  import ProposalReviewList from '$lib/features/proposals/ProposalReviewList.svelte';
  import {
    EMPTY_RELATED_REASON,
    getBottomSheetStyle,
    getCardStyle,
    getRelatedDrawerStyle
  } from '$lib/features/notepad/related/layout';
  import { createRelatedNotesStore } from '$lib/features/notepad/related/store';
  import { createNotepadSearchStore } from '$lib/features/notepad/search/store';
  import { findProseMirrorElement } from '$lib/features/notepad/editor/editorDom';
  import { createEditorLifecycleController } from '$lib/features/notepad/editor/editorLifecycleController';
  import {
    getPaneIdForSlashMenuView,
    setSlashMenuListener
  } from '$lib/features/notepad/editor/slashMenuBridge';
  import type { SlashMenuSnapshot } from '$lib/features/notepad/editor/slashMenu';
  import { createWikilinkRuntime } from '$lib/features/notepad/wikilinks/runtime';
  import {
    activeProposalSession,
    getProposalChangesForPath,
    toggleProposalChange,
    toggleProposalHunk,
    toggleProposalTitle
  } from '$lib/features/proposals/session';
  import {
    adoptSnapshotForPane,
    applySnapshotToNote,
    createFreshDraftNote,
    createNotepadState,
    getActiveNote,
    getPaneNote,
    getPaneState,
    listReferencedNoteKeys,
    noteKeyFromPath,
    rekeyNote,
    removeNoteIfUnreferenced,
    replaceReferencedNoteWithFreshDraft,
    setActivePane as setStoreActivePane,
    setNoteStatus,
    setPaneKind as setStoredPaneKind,
    setPaneNoteKey as setStoredPaneNoteKey,
    type NoteDraftState,
    type NoteKey
  } from '$lib/features/notepad/state/noteStore';
  import { cancelScheduledAutoSync, runAutoSyncNow, scheduleAutoSync } from '$lib/sync/autoSync';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';

  type PaneId = typeof PRIMARY_PANE_ID | typeof SECONDARY_PANE_ID;
  type PaneKind = 'editor' | 'chat';

  interface PaneUiState {
    isEditorReady: boolean;
    isApplyingExternalContent: boolean;
    wikilinkAutocomplete: WikilinkAutocompleteState;
    editorGeneration: number;
    slashMenu: PaneSlashMenuModel;
  }

  interface VaultNoteChangeEvent {
    notePath: string;
    deleted: boolean;
  }

  const PRIMARY_PANE_ID = 'notepad-primary';
  const SECONDARY_PANE_ID = 'notepad-secondary';
  const proseMirrorInteractionEvents = ['mouseup', 'touchend', 'focusout'] as const;

  let workspaceShell = $state<HTMLDivElement | null>(null);
  let primaryPaneCard = $state<HTMLDivElement | null>(null);
  let primaryEditorShell = $state<HTMLDivElement | null>(null);
  let primaryEditorRoot = $state<HTMLDivElement | null>(null);
  let primaryTitleInput = $state<HTMLInputElement | null>(null);
  let primaryTitleShell = $state<HTMLDivElement | null>(null);
  let primaryController: EditorController | null = null;

  let secondaryPaneCard = $state<HTMLDivElement | null>(null);
  let secondaryEditorShell = $state<HTMLDivElement | null>(null);
  let secondaryEditorRoot = $state<HTMLDivElement | null>(null);
  let secondaryTitleInput = $state<HTMLInputElement | null>(null);
  let secondaryTitleShell = $state<HTMLDivElement | null>(null);
  let secondaryController: EditorController | null = null;

  let paneOrder = $state<PaneId[]>([PRIMARY_PANE_ID]);
  let activePaneId = $state<PaneId>(PRIMARY_PANE_ID);
  let paneStates = $state<Record<PaneId, PaneUiState>>({
    [PRIMARY_PANE_ID]: {
      isEditorReady: false,
      isApplyingExternalContent: false,
      wikilinkAutocomplete: createWikilinkAutocompleteState(),
      editorGeneration: 0,
      slashMenu: { open: false }
    },
    [SECONDARY_PANE_ID]: {
      isEditorReady: false,
      isApplyingExternalContent: false,
      wikilinkAutocomplete: createWikilinkAutocompleteState(),
      editorGeneration: 0,
      slashMenu: { open: false }
    }
  });

  let notepadState = $state(
    createNotepadState(PRIMARY_PANE_ID, [PRIMARY_PANE_ID, SECONDARY_PANE_ID] as const)
  );
  let documentSession = $derived.by(() => getActiveNote(notepadState));
  const sharedEditorResourcesByNoteKey = new Map<
    NoteKey,
    ReturnType<typeof createSharedEditorResources>
  >();
  const sharedEditorStateByNoteKey = new Map<NoteKey, EditorState | null>();
  const sharedEditorStateGenerationByNoteKey = new Map<NoteKey, number>();
  const noteSaveTimers = new Map<NoteKey, ReturnType<typeof window.setTimeout>>();
  const noteSaveQueues = new Map<NoteKey, Promise<void>>();
  const cursorSaveTimers = new Map<PaneId, ReturnType<typeof window.setTimeout>>();
  const documentSyncFrameIds = new Map<NoteKey, number>();
  const openNoteRequestGenerationByPane = new Map<PaneId, number>([
    [PRIMARY_PANE_ID, 0],
    [SECONDARY_PANE_ID, 0]
  ]);

  let canUnforget = $derived(notepadState.recentlyForgotten !== null);
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;
  let assetRootPath = $state<string | null>(null);
  let semanticStatus = $state<SemanticStatus | null>(null);
  let proposalErrorMessage = $state('');
  let currentSearchHighlightMode: SearchMode = 'all';
  let currentSearchHighlightQuery = '';

  const searchState = createNotepadSearchStore({
    getCurrentTitle: () => documentSession.title,
    getCurrentMarkdown,
    getCurrentPath: () => documentSession.currentNotePath,
    openSearchResult: handleSearchResultSelect,
    openRecentTask: handleRecentTaskSelect,
    openNote: async (noteId, notePath) => openNotePath(notePath, { noteId }),
    onSearchStateChange: ({ searchMode, searchQuery }) => {
      currentSearchHighlightMode = searchMode;
      currentSearchHighlightQuery = searchQuery;
      syncCurrentFileSearchHighlights(searchQuery, searchMode);
    }
  });

  const relatedState = createRelatedNotesStore({
    getCurrentTitle: () => documentSession.title,
    getCurrentMarkdown,
    getCurrentPath: () => documentSession.currentNotePath
  });

  let splitPickerPaneId = $state<PaneId | null>(null);
  let splitPickerSourceNoteKey = $state<NoteKey | null>(null);
  let splitPickerHighlightedIndex = $state(0);
  let splitPickerFocusEl = $state<HTMLElement | null>(null);

  let splitPickerCurrentNoteLabel = $derived.by(() => {
    if (!splitPickerSourceNoteKey) {
      return 'Untitled note';
    }

    const note = notepadState.notesByKey[splitPickerSourceNoteKey];
    if (!note) {
      return 'Untitled note';
    }

    const trimmed = note.title.trim();
    if (trimmed) {
      return trimmed;
    }

    const path = note.currentNotePath;
    if (path) {
      return path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled note';
    }

    return 'Untitled note';
  });

  function searchItemMatchesSplitSource(item: SearchItem, path: string | null, id: string | null) {
    const itemPath = item.notePath ?? null;
    const itemId = item.noteId ?? null;
    if (path && itemPath) {
      return path === itemPath;
    }

    if (!path && !itemPath) {
      return (id ?? null) === (itemId ?? null);
    }

    return false;
  }

  let splitPickerPreviousItem = $derived.by((): SearchItem | null => {
    if (splitPickerPaneId === null || !splitPickerSourceNoteKey) {
      return null;
    }

    const source = notepadState.notesByKey[splitPickerSourceNoteKey];
    const path = source?.currentNotePath ?? null;
    const id = source?.currentNoteId ?? null;

    for (const item of $searchState.recentNotes) {
      if (searchItemMatchesSplitSource(item, path, id)) {
        continue;
      }

      return item;
    }

    return null;
  });

  let splitPickerPreviousNoteLabel = $derived(
    splitPickerPreviousItem
      ? splitPickerPreviousItem.fileName?.trim() ||
          splitPickerPreviousItem.notePath ||
          'Recent note'
      : null
  );

  function getPaneKind(paneId: PaneId) {
    return getPaneState(notepadState, paneId).kind;
  }

  function getPaneController(paneId: PaneId) {
    return paneId === PRIMARY_PANE_ID ? primaryController : secondaryController;
  }

  function setPaneController(paneId: PaneId, value: EditorController | null) {
    if (paneId === PRIMARY_PANE_ID) {
      primaryController = value;
      return;
    }

    secondaryController = value;
  }

  function getPaneCardElement(paneId: PaneId) {
    return paneId === PRIMARY_PANE_ID ? primaryPaneCard : secondaryPaneCard;
  }

  function getPaneEditorShell(paneId: PaneId) {
    return paneId === PRIMARY_PANE_ID ? primaryEditorShell : secondaryEditorShell;
  }

  function getPaneEditorRoot(paneId: PaneId) {
    return paneId === PRIMARY_PANE_ID ? primaryEditorRoot : secondaryEditorRoot;
  }

  function getPaneTitleInput(paneId: PaneId) {
    return paneId === PRIMARY_PANE_ID ? primaryTitleInput : secondaryTitleInput;
  }

  function getPaneTitleShell(paneId: PaneId) {
    return paneId === PRIMARY_PANE_ID ? primaryTitleShell : secondaryTitleShell;
  }

  function applySlashMenuSnapshotForPane(
    paneId: PaneId,
    snapshot: SlashMenuSnapshot,
    view: EditorView
  ) {
    if (!snapshot.open) {
      paneStates[paneId].slashMenu = { open: false };
      return;
    }
    paneStates[paneId].slashMenu = {
      open: true,
      view,
      anchorPos: snapshot.anchorPos,
      groups: snapshot.groups,
      hoverIndex: snapshot.hoverIndex
    };
  }

  function getVisiblePaneIds() {
    return paneOrder;
  }

  function getEditorPaneIds() {
    return getVisiblePaneIds().filter((paneId) => getPaneKind(paneId) === 'editor');
  }

  function getNavigationPaneId() {
    if (getPaneKind(activePaneId) === 'editor') {
      return activePaneId;
    }

    return getEditorPaneIds()[0] ?? activePaneId;
  }

  function focusTitleAtEnd(paneId: PaneId = getNavigationPaneId()) {
    focusInputAtEnd(getPaneTitleInput(paneId));
  }

  function getNavigationContext(paneId: PaneId = getNavigationPaneId()): NavigationContext {
    const paneDocument = getPaneDocumentSession(paneId);
    return {
      editorRoot: getPaneEditorRoot(paneId),
      titleShell: getPaneTitleShell(paneId),
      currentNoteId: paneDocument.currentNoteId,
      currentNotePath: paneDocument.currentNotePath,
      focusTitleAtEnd: () => focusTitleAtEnd(paneId)
    };
  }

  function getOpenContext(): OpenContext {
    return {
      currentNoteId: documentSession.currentNoteId,
      currentNotePath: documentSession.currentNotePath,
      stopPendingAutosave: cancelPendingAutosave,
      clearSearch,
      openNotePath: async (noteId, notePath, options) => openNotePath(notePath, { noteId, ...options })
    };
  }

  function getDocumentSession() {
    return documentSession;
  }

  function getNoteByKey(noteKey: NoteKey) {
    return notepadState.notesByKey[noteKey] ?? null;
  }

  function getPaneDocumentSession(paneId: PaneId) {
    return getPaneNote(notepadState, paneId);
  }

  function setPaneDocumentSession(paneId: PaneId, document: NoteDraftState) {
    setStoredPaneNoteKey(notepadState, paneId, document.key);
    if (activePaneId === paneId) {
      setStoreActivePane(notepadState, paneId);
    }
    return document;
  }

  function activatePaneSession(paneId: PaneId) {
    activePaneId = paneId;
    setStoreActivePane(notepadState, paneId);
    return getPaneState(notepadState, paneId);
  }

  function getPaneIdsForDocument(document: NoteDraftState) {
    return getVisiblePaneIds().filter(
      (paneId) => getPaneKind(paneId) === 'editor' && getPaneDocumentSession(paneId).key === document.key
    );
  }

  function setRecentlyForgotten(value: ForgottenNote | null) {
    notepadState.recentlyForgotten = value;
  }

  function getCurrentMarkdown() {
    return documentSession.bodyMarkdown;
  }

  function getSharedEditorStateGeneration(document: NoteDraftState) {
    return sharedEditorStateGenerationByNoteKey.get(document.key) ?? 0;
  }

  function setSharedEditorStateGeneration(document: NoteDraftState, generation: number) {
    if (generation === 0) {
      sharedEditorStateGenerationByNoteKey.delete(document.key);
      return;
    }
    sharedEditorStateGenerationByNoteKey.set(document.key, generation);
  }

  function bumpSharedEditorStateGeneration(document: NoteDraftState) {
    const nextGeneration = getSharedEditorStateGeneration(document) + 1;
    sharedEditorStateGenerationByNoteKey.set(document.key, nextGeneration);
    return nextGeneration;
  }

  function getSharedEditorStateForDocument(document: NoteDraftState) {
    return sharedEditorStateByNoteKey.get(document.key) ?? null;
  }

  function setSharedEditorStateForDocument(
    document: NoteDraftState,
    editorState: EditorState | null
  ) {
    if (editorState) {
      sharedEditorStateByNoteKey.set(document.key, editorState);
      return;
    }
    sharedEditorStateByNoteKey.delete(document.key);
  }

  function getSharedEditorResources(document: NoteDraftState) {
    let resources = sharedEditorResourcesByNoteKey.get(document.key);
    if (resources) {
      return resources;
    }

    resources = createSharedEditorResources({
      assetRootPath,
      onTaskListToggle: () => {
        flushPendingAutosave();
      },
      onStorePastedImage: storePastedImageAsset
    });
    sharedEditorResourcesByNoteKey.set(document.key, resources);
    return resources;
  }

  function transferNoteRuntime(oldKey: NoteKey, nextKey: NoteKey) {
    if (oldKey === nextKey) {
      return;
    }

    const sharedEditorState = sharedEditorStateByNoteKey.get(oldKey);
    if (sharedEditorState && !sharedEditorStateByNoteKey.has(nextKey)) {
      sharedEditorStateByNoteKey.set(nextKey, sharedEditorState);
    }

    const generation = sharedEditorStateGenerationByNoteKey.get(oldKey);
    if (generation !== undefined && !sharedEditorStateGenerationByNoteKey.has(nextKey)) {
      sharedEditorStateGenerationByNoteKey.set(nextKey, generation);
    }

    const resources = sharedEditorResourcesByNoteKey.get(oldKey);
    if (resources && !sharedEditorResourcesByNoteKey.has(nextKey)) {
      sharedEditorResourcesByNoteKey.set(nextKey, resources);
    }

    const pendingTimer = noteSaveTimers.get(oldKey);
    if (pendingTimer && !noteSaveTimers.has(nextKey)) {
      noteSaveTimers.set(nextKey, pendingTimer);
    }

    const pendingQueue = noteSaveQueues.get(oldKey);
    if (pendingQueue && !noteSaveQueues.has(nextKey)) {
      noteSaveQueues.set(nextKey, pendingQueue);
    }

    const frameId = documentSyncFrameIds.get(oldKey);
    if (frameId !== undefined && !documentSyncFrameIds.has(nextKey)) {
      documentSyncFrameIds.set(nextKey, frameId);
    }

    sharedEditorStateByNoteKey.delete(oldKey);
    sharedEditorStateGenerationByNoteKey.delete(oldKey);
    sharedEditorResourcesByNoteKey.delete(oldKey);
    noteSaveTimers.delete(oldKey);
    noteSaveQueues.delete(oldKey);
    documentSyncFrameIds.delete(oldKey);
  }

  function cleanupNoteRuntime(noteKey: NoteKey) {
    const pendingTimer = noteSaveTimers.get(noteKey);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      noteSaveTimers.delete(noteKey);
    }

    const frameId = documentSyncFrameIds.get(noteKey);
    if (frameId !== undefined) {
      window.cancelAnimationFrame(frameId);
      documentSyncFrameIds.delete(noteKey);
    }

    sharedEditorStateByNoteKey.delete(noteKey);
    sharedEditorStateGenerationByNoteKey.delete(noteKey);
    sharedEditorResourcesByNoteKey.delete(noteKey);
    noteSaveQueues.delete(noteKey);
  }

  function flushPaneCursorSave(paneId: PaneId) {
    const pendingTimer = cursorSaveTimers.get(paneId);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      cursorSaveTimers.delete(paneId);
    }

    paneControllers[paneId].editorLifecycleController.saveCursorPositionForDocument(
      getPaneDocumentSession(paneId)
    );
  }

  function schedulePaneCursorSave(paneId: PaneId) {
    const pendingTimer = cursorSaveTimers.get(paneId);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
    }

    cursorSaveTimers.set(
      paneId,
      window.setTimeout(() => {
        cursorSaveTimers.delete(paneId);
        paneControllers[paneId].editorLifecycleController.saveCursorPositionForDocument(
          getPaneDocumentSession(paneId)
        );
      }, 220)
    );
  }

  function flushAllPendingCursorSaves() {
    flushPaneCursorSave(PRIMARY_PANE_ID);
    flushPaneCursorSave(SECONDARY_PANE_ID);
  }

  function markPaneDocumentGeneration(
    paneId: PaneId,
    document: NoteDraftState = getPaneDocumentSession(paneId)
  ) {
    paneStates[paneId].editorGeneration = getSharedEditorStateGeneration(document);
  }

  function flushDocumentEditorSync(document: NoteDraftState) {
    const frameId = documentSyncFrameIds.get(document.key);
    if (frameId !== undefined) {
      window.cancelAnimationFrame(frameId);
      documentSyncFrameIds.delete(document.key);
    }

    const sharedEditorState = getSharedEditorStateForDocument(document);
    if (!sharedEditorState) {
      return;
    }

    for (const paneId of getPaneIdsForDocument(document)) {
      if (paneStates[paneId].editorGeneration >= getSharedEditorStateGeneration(document)) {
        continue;
      }

      const controller = getPaneController(paneId);
      if (!controller) {
        markPaneDocumentGeneration(paneId, document);
        continue;
      }

      if (paneControllers[paneId].editorLifecycleController.applySharedEditorStateForDocument(document)) {
        markPaneDocumentGeneration(paneId, document);
      }
    }
  }

  function scheduleDocumentEditorSync(document: NoteDraftState) {
    if (documentSyncFrameIds.has(document.key)) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      documentSyncFrameIds.delete(document.key);
      flushDocumentEditorSync(document);
    });
    documentSyncFrameIds.set(document.key, frameId);
  }

  function flushAllPendingDocumentSyncs() {
    const noteKeys = new Set<NoteKey>([
      ...documentSyncFrameIds.keys(),
      ...listReferencedNoteKeys(notepadState)
    ]);

    for (const noteKey of noteKeys) {
      const document = getNoteByKey(noteKey);
      if (document) {
        flushDocumentEditorSync(document);
      }
    }
  }

  function saveCursorPositionForDocument(document: NoteDraftState = getDocumentSession()) {
    for (const paneId of getPaneIdsForDocument(document)) {
      const pendingTimer = cursorSaveTimers.get(paneId);
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        cursorSaveTimers.delete(paneId);
      }
      paneControllers[paneId].editorLifecycleController.saveCursorPositionForDocument(document);
    }
  }

  function saveSharedEditorStateForDocument(
    document: NoteDraftState = getDocumentSession(),
    editorState: EditorState | null = null,
    preferredPaneId: PaneId = getNavigationPaneId()
  ) {
    const paneIds = getPaneIdsForDocument(document);
    const paneId =
      (paneIds.includes(preferredPaneId) ? preferredPaneId : paneIds[0]) ?? null;
    if (!paneId) {
      if (!getSharedEditorStateForDocument(document) && editorState) {
        setSharedEditorStateForDocument(document, editorState);
      }
      return;
    }

    if (
      getSharedEditorStateForDocument(document) &&
      paneStates[paneId].editorGeneration < getSharedEditorStateGeneration(document)
    ) {
      return;
    }

    paneControllers[paneId].editorLifecycleController.saveSharedEditorStateForDocument(
      document,
      editorState
    );
  }

  function discardSharedEditorStateForDocument(document: NoteDraftState) {
    setSharedEditorStateForDocument(document, null);
    setSharedEditorStateGeneration(document, 0);
  }

  async function replaceEditorContent(
    nextMarkdown: string,
    options: {
      preserveScroll?: boolean;
      restoreCursor?: boolean;
    } = {}
  ) {
    const document = getDocumentSession();
    for (const paneId of getPaneIdsForDocument(document)) {
      await paneControllers[paneId].editorLifecycleController.replaceEditorContent(nextMarkdown, options);
    }
  }

  async function replaceEditorContentInPlace(nextMarkdown: string) {
    const document = getDocumentSession();
    for (const paneId of getPaneIdsForDocument(document)) {
      await paneControllers[paneId].editorLifecycleController.replaceEditorContentInPlace(nextMarkdown);
    }
  }

  async function replaceEditorContentInPlaceForDocument(
    nextMarkdown: string,
    document: NoteDraftState
  ) {
    for (const paneId of getPaneIdsForDocument(document)) {
      await paneControllers[paneId].editorLifecycleController.replaceEditorContentInPlaceForDocument(
        nextMarkdown,
        document
      );
    }
  }

  async function restoreSharedEditorStateForDocument(document: NoteDraftState) {
    if (!getSharedEditorStateForDocument(document)) {
      return false;
    }

    let restored = false;
    for (const paneId of getPaneIdsForDocument(document)) {
      const paneRestored =
        await paneControllers[paneId].editorLifecycleController.restoreSharedEditorStateForDocument(
          document
        );
      if (paneRestored) {
        markPaneDocumentGeneration(paneId, document);
        restored = true;
      }
    }
    return restored;
  }

  function closeWikilinkAutocomplete(paneId?: PaneId) {
    if (paneId) {
      paneControllers[paneId].wikilinkController.closeWikilinkAutocomplete();
      return;
    }

    paneControllers[PRIMARY_PANE_ID].wikilinkController.closeWikilinkAutocomplete();
    paneControllers[SECONDARY_PANE_ID].wikilinkController.closeWikilinkAutocomplete();
  }

  function handleEditorMarkdownChange(
    paneId: string,
    document: NoteDraftState,
    nextMarkdown: string,
    editorState: EditorState | null
  ) {
    const resolvedPaneId = paneId as PaneId;
    if (editorState) {
      setSharedEditorStateForDocument(document, editorState);
      bumpSharedEditorStateGeneration(document);
      markPaneDocumentGeneration(resolvedPaneId, document);
    }

    if (document.bodyMarkdown !== nextMarkdown) {
      document.bodyMarkdown = nextMarkdown;
      document.operationRevision += 1;
    }
    if (
      getPaneIdsForDocument(document).some((paneId) => paneStates[paneId].isApplyingExternalContent) ||
      isDocumentUnderProposal(document)
    ) {
      return;
    }

    if (nextMarkdown.trim() !== '') {
      setRecentlyForgotten(null);
    }

    if (getPaneIdsForDocument(document).length > 1) {
      scheduleDocumentEditorSync(document);
    }

    scheduleAutosave(document);
    scheduleSearch();
    scheduleRelated();
  }

  function handleTitleInput(paneId: PaneId, event: Event) {
    activatePaneSession(paneId);
    const paneDocument = getPaneDocumentSession(paneId);
    if (isDocumentUnderProposal(paneDocument)) {
      return;
    }

    const nextTitle = (event.currentTarget as HTMLInputElement).value;
    if (paneDocument.title !== nextTitle) {
      paneDocument.title = nextTitle;
      paneDocument.operationRevision += 1;
    }
    if (paneDocument.title.trim() !== '' || paneDocument.bodyMarkdown.trim() !== '') {
      setRecentlyForgotten(null);
    }
    scheduleAutosave(paneDocument);
    scheduleSearch();
    scheduleRelated();
  }

  function handleTitleBlur() {
    if (isCurrentNoteUnderProposal) {
      return;
    }

    flushPendingAutosave();
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void focusEditorAtEnd(getPaneEditorRoot(getNavigationPaneId()));
  }

  async function handleSearchResultSelect(result: SearchItem) {
    await openSearchResult(getOpenContext(), getNavigationContext(), result);
    saveCursorPositionForDocument();
  }

  async function handleRecentTaskSelect(task: RecentTaskItem) {
    await openRecentTask(getOpenContext(), getNavigationContext(), task);
    saveCursorPositionForDocument();
  }

  async function handleRelatedItemSelect(item: RelatedNoteItem) {
    await openSearchResult(getOpenContext(), getNavigationContext(), {
      noteId: item.noteId,
      notePath: item.notePath,
      fileName: item.noteTitle,
      sectionLabel: item.sectionLabel,
      excerpt: item.excerpt,
      highlightRanges: [],
      matchText: item.matchText,
      reasonLabels: ['related'],
      lexicalScore: null,
      semanticScore: item.score,
      startLine: item.startLine,
      endLine: item.endLine
    });
    saveCursorPositionForDocument();
  }

  async function handleGlobalKeydown(event: KeyboardEvent) {
    if (handleWikilinkKeydown(event)) {
      return;
    }

    if (handleSplitPickerGlobalKeydown(event)) {
      return;
    }

    const lowerKey = event.key.toLowerCase();

    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.code === 'Slash'
    ) {
      if (event.repeat || paneOrder.length > 1) {
        return;
      }

      const preferTitle = document.activeElement === getPaneTitleInput(activePaneId);
      event.preventDefault();
      await splitWorkspace();
      focusPaneAfterShortcut(activePaneId, { preferTitle });
      return;
    }

    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      lowerKey === 'w'
    ) {
      if (event.repeat || paneOrder.length < 2) {
        return;
      }

      const preferTitle = document.activeElement === getPaneTitleInput(activePaneId);
      event.preventDefault();
      await closePane(activePaneId);
      focusPaneAfterShortcut(activePaneId, { preferTitle });
      return;
    }

    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      lowerKey === 's'
    ) {
      if (event.repeat) {
        return;
      }

      event.preventDefault();
      await rememberCurrentNote(defaultRememberShortcutAction);
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && lowerKey === 'tab') {
      if (event.repeat || paneOrder.length < 2) {
        return;
      }

      event.preventDefault();
      await switchActivePane();
      return;
    }

    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      lowerKey === 'r'
    ) {
      event.preventDefault();
      toggleRelatedPanel();
      return;
    }

    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      lowerKey === 'l'
    ) {
      event.preventDefault();
      void openRecentNoteByIndex(0, { forceReload: true });
      return;
    }

    if (!event.metaKey || lowerKey !== 'f') return;

    event.preventDefault();
    requestSearchFocus(event.shiftKey ? 'all' : 'current');
  }

  function handleWindowFocus() {
    void syncAndRefresh('window-focus');
  }

  function handleWindowResize() {
    updateRelatedDrawerLayout();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void syncAndRefresh('window-visible');
    }
  }

  function refreshDerivedViews() {
    void loadRecentNotes();
    void loadRecentTasks();
    if ($searchState.searchQuery.trim() !== '') {
      scheduleSearch();
    }
    scheduleRelated({ immediate: true });
  }

  async function syncAndRefresh(reason: string) {
    await runAutoSyncNow(reason);
    await refreshCurrentNoteIfChanged();
    refreshDerivedViews();
  }

  async function handleVaultNoteChanged(payload: VaultNoteChangeEvent) {
    if (documentSession.currentNotePath === payload.notePath) {
      await refreshCurrentNoteIfChanged();
    } else if (payload.deleted) {
      const noteKey = noteKeyFromPath(payload.notePath);
      if (noteKey) {
        const note = getNoteByKey(noteKey);
        if (note) {
          if (getPaneIdsForDocument(note).length > 0) {
            const freshDraft = replaceReferencedNoteWithFreshDraft(notepadState, note.key);
            await replaceNoteAcrossPanes(note, freshDraft);
          }
        }
      }
    }
    refreshDerivedViews();
    scheduleAutoSync('vault-note-change', 1200);
  }

  async function loadRememberCapabilities() {
    try {
      semanticStatus = await invoke<SemanticStatus>('get_semantic_status');
    } catch (error) {
      console.error('Failed to load semantic status for remember modes:', error);
      semanticStatus = null;
    }
  }

  function integrateDisabledReason() {
    if (!semanticStatus) {
      return 'Integrate needs semantic search status.';
    }
    if (!semanticStatus.platformSupported) {
      return semanticStatus.disabledReason ?? 'Integrate is unavailable on this platform.';
    }
    if (!semanticStatus.settings.semanticSearchEnabled) {
      return 'Enable semantic search in Settings to use integrate.';
    }
    if (semanticStatus.indexedNotes === 0) {
      return 'Integrate needs at least one indexed note in the vault.';
    }
    return null;
  }

  function canIntegrate() {
    return integrateDisabledReason() === null;
  }

  const {
    clearSearch,
    scheduleSearch,
    loadRecentNotes,
    loadRecentTasks,
    openRecentNoteItem,
    openRecentNoteByIndex,
    openRecentTaskByIndex,
    handleSearchInput,
    handleSearchModeChange,
    handleSearchFocus,
    requestSearchFocus
  } = searchState;

  const {
    updateDrawerLayout: updateRelatedDrawerLayoutController,
    clearSelectedRelatedText: clearSelectedRelatedTextController,
    scheduleRelated,
    handleRelatedScopeChange,
    toggleRelatedPanel: toggleRelatedPanelController,
    updateSelectedRelatedText: updateSelectedRelatedTextController
  } = relatedState;

  function getCurrentFileSearchHighlightQuery(
    query: string = currentSearchHighlightQuery,
    mode: SearchMode = currentSearchHighlightMode
  ) {
    if (mode !== 'current') {
      return null;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery === '' || trimmedQuery.startsWith('/')) {
      return null;
    }

    return trimmedQuery;
  }

  function syncCurrentFileSearchHighlights(
    query: string = currentSearchHighlightQuery,
    mode: SearchMode = currentSearchHighlightMode
  ) {
    for (const paneId of getEditorPaneIds()) {
      setEditorCurrentSearchHighlightQuery(getPaneController(paneId), null);
    }

    const highlightQuery = getCurrentFileSearchHighlightQuery(query, mode);
    if (!highlightQuery) {
      return;
    }

    for (const paneId of getPaneIdsForDocument(documentSession)) {
      setEditorCurrentSearchHighlightQuery(getPaneController(paneId), highlightQuery);
    }
  }

  $effect(() => {
    documentSession.key;
    untrack(() => {
      syncCurrentFileSearchHighlights();
    });
  });

  function updatePaneWikilinkState(paneId: PaneId, nextState: WikilinkAutocompleteState) {
    paneStates[paneId].wikilinkAutocomplete = nextState;
  }

  const paneControllers = {
    [PRIMARY_PANE_ID]: createPaneRuntime(PRIMARY_PANE_ID),
    [SECONDARY_PANE_ID]: createPaneRuntime(SECONDARY_PANE_ID)
  } as const;

  function createPaneRuntime(paneId: PaneId) {
    const editorLifecycleController = createEditorLifecycleController({
      getController: () => getPaneController(paneId),
      getPaneId: () => paneId,
      setController: (value) => {
        setPaneController(paneId, value);
      },
      getShellElement: () => getPaneCardElement(paneId),
      getEditorShell: () => getPaneEditorShell(paneId),
      getEditorRoot: () => getPaneEditorRoot(paneId),
      getDocumentSession: () => getPaneDocumentSession(paneId),
      getSharedEditorState: getSharedEditorStateForDocument,
      setSharedEditorState: setSharedEditorStateForDocument,
      setIsEditorReady: (value) => {
        paneStates[paneId].isEditorReady = value;
      },
      setIsApplyingExternalContent: (value) => {
        paneStates[paneId].isApplyingExternalContent = value;
      },
      handleEditorMarkdownChange,
      getSharedEditorResources,
      getViewCallbacks: () => ({
        onOpenLink: (rawTarget) => {
          activatePaneSession(paneId);
          void openWikilink(paneId, rawTarget);
        },
        onActiveWikilinkChange: (activeWikilink) => {
          handleActiveWikilinkChange(paneId, activeWikilink);
        }
      }),
      closeTransientUi: () => closeWikilinkAutocomplete(paneId)
    });

    const wikilinkController = createWikilinkRuntime({
      getState: () => paneStates[paneId].wikilinkAutocomplete,
      setState: (value) => {
        updatePaneWikilinkState(paneId, value);
      },
      getCurrentNoteId: () => getPaneDocumentSession(paneId).currentNoteId,
      getCurrentPath: () => getPaneDocumentSession(paneId).currentNotePath,
      getCurrentTitle: () => getPaneDocumentSession(paneId).title,
      getCurrentMarkdown: () => getPaneDocumentSession(paneId).bodyMarkdown,
      getEditorController: () => getPaneController(paneId),
      cancelPendingAutosave,
      openNotePath: async (noteId, notePath, options) => {
        activatePaneSession(paneId);
        return openNotePath(notePath, { noteId, ...options });
      },
      getNavigationContext: () => getNavigationContext(paneId),
      saveCursorPositionForNote: () => {
        editorLifecycleController.saveCursorPositionForDocument();
      }
    });

    return {
      editorLifecycleController,
      wikilinkController
    };
  }

  function hasCleanBuffer(note: NoteDraftState = getDocumentSession()) {
    return shouldSkipAutosave(
      note.title,
      note.bodyMarkdown,
      note.currentNoteId,
      note.currentNotePath,
      note
    );
  }

  function invalidatePendingSaveResults(note: NoteDraftState = getDocumentSession()) {
    note.operationRevision += 1;
  }

  function getNoteSaveQueue(noteKey: NoteKey) {
    return noteSaveQueues.get(noteKey) ?? Promise.resolve();
  }

  function queueNoteOperation(note: NoteDraftState, operation: () => Promise<void>) {
    const queue = getNoteSaveQueue(note.key)
      .then(operation)
      .catch((error) => {
        console.error('Notepad note operation failed:', error);
        setNoteStatus(note, 'error');
      });
    noteSaveQueues.set(note.key, queue);
    return queue;
  }

  function rekeyNoteWithRuntime(note: NoteDraftState, snapshot: SessionSnapshot) {
    const nextKey = noteKeyFromPath(snapshot.currentNotePath);
    if (!nextKey || nextKey === note.key) {
      return note;
    }

    const previousKey = note.key;
    const nextNote = rekeyNote(notepadState, previousKey, nextKey) ?? note;
    transferNoteRuntime(previousKey, nextKey);
    if (!getNoteByKey(previousKey)) {
      cleanupNoteRuntime(previousKey);
    }
    return nextNote;
  }

  async function persistNote(note: NoteDraftState) {
    const operationRevision = note.operationRevision;
    const title = note.title;
    const markdown = note.bodyMarkdown;
    const currentNoteId = note.currentNoteId;
    const currentNotePath = note.currentNotePath;

    if (shouldSkipAutosave(title, markdown, currentNoteId, currentNotePath, note)) {
      return;
    }

    setNoteStatus(note, 'saving');
    const savedSession = await saveNoteSession(title, markdown, currentNotePath);
    if (note.operationRevision !== operationRevision) {
      return;
    }

    const preserveDraft =
      note.title !== title ||
      note.bodyMarkdown !== markdown ||
      note.currentNoteId !== currentNoteId ||
      note.currentNotePath !== currentNotePath;

    const savedNote = rekeyNoteWithRuntime(note, savedSession);
    applySnapshotToNote(savedNote, savedSession, { preserveDraft });
    setNoteStatus(savedNote, 'idle');
    scheduleAutoSync('note-saved', 600);
  }

  function scheduleAutosave(note: NoteDraftState = getDocumentSession()) {
    cancelPendingAutosave(note);
    noteSaveTimers.set(
      note.key,
      window.setTimeout(() => {
        noteSaveTimers.delete(note.key);
        void enqueueSave(note);
      }, 1000)
    );
  }

  function cancelPendingAutosave(note: NoteDraftState = getDocumentSession()) {
    const pendingTimer = noteSaveTimers.get(note.key);
    if (!pendingTimer) {
      return;
    }

    window.clearTimeout(pendingTimer);
    noteSaveTimers.delete(note.key);
  }

  async function enqueueSave(note: NoteDraftState = getDocumentSession()) {
    return queueNoteOperation(note, () => persistNote(note));
  }

  function flushPendingAutosave(note: NoteDraftState = getDocumentSession()) {
    const pendingTimer = noteSaveTimers.get(note.key);
    if (!pendingTimer) {
      return;
    }

    window.clearTimeout(pendingTimer);
    noteSaveTimers.delete(note.key);
    void enqueueSave(note);
  }

  async function replaceNoteAcrossPanes(
    previousNote: NoteDraftState,
    nextNote: NoteDraftState,
    { restoreCursor = false }: { restoreCursor?: boolean } = {}
  ) {
    for (const paneId of getVisiblePaneIds()) {
      if (getPaneKind(paneId) !== 'editor') {
        continue;
      }

      if (getPaneDocumentSession(paneId).key !== nextNote.key) {
        continue;
      }

      if (!getPaneController(paneId)) {
        markPaneDocumentGeneration(paneId, nextNote);
        continue;
      }

      await paneControllers[paneId].editorLifecycleController.replaceEditorContent(
        nextNote.bodyMarkdown,
        {
          restoreCursor
        }
      );
      markPaneDocumentGeneration(paneId, nextNote);
    }

    if (!getNoteByKey(previousNote.key)) {
      cleanupNoteRuntime(previousNote.key);
    }
  }

  async function loadSavedNote() {
    try {
      const snapshot = await loadSavedNoteSession();
      adoptSnapshotForPane(notepadState, PRIMARY_PANE_ID, snapshot);
      setStoreActivePane(notepadState, PRIMARY_PANE_ID);
    } catch (error) {
      console.error('Failed to load saved note:', error);
      applySnapshotToNote(getPaneDocumentSession(PRIMARY_PANE_ID), createEmptySessionSnapshot());
    }
  }

  async function loadAssetRoot() {
    try {
      const vaultInfo = await loadCurrentVaultInfo();
      assetRootPath = resolveAssetRootPath(vaultInfo.currentPath);
    } catch (error) {
      console.error('Failed to load vault info for image assets:', error);
      assetRootPath = null;
    }
  }

  async function refreshCurrentNoteIfChanged() {
    const note = getDocumentSession();
    const currentPath = note.currentNotePath;
    if (
      !currentPath ||
      !getPaneIdsForDocument(note).some((paneId) => paneStates[paneId].isEditorReady) ||
      notepadState.isRefreshingFromDisk ||
      !hasCleanBuffer(note)
    ) {
      return;
    }

    notepadState.isRefreshingFromDisk = true;
    try {
      const session = await readNoteSession(note.currentNoteId, currentPath);
      if (getDocumentSession().key !== note.key || !hasCleanBuffer(note)) {
        return;
      }

      if (
        session.lastSavedTitle === note.lastSavedTitle &&
        session.lastSavedMarkdown === note.lastSavedMarkdown &&
        session.lastSavedNoteId === note.lastSavedNoteId &&
        session.lastSavedPath === note.lastSavedPath
      ) {
        return;
      }

      applySnapshotToNote(note, session);
      setRecentlyForgotten(null);
      await replaceEditorContentInPlace(session.bodyMarkdown);
      clearSelectedRelatedText();
      scheduleSearch();
      scheduleRelated({ immediate: true });
    } catch (error) {
      console.error('Failed to refresh note from disk:', error);
    } finally {
      notepadState.isRefreshingFromDisk = false;
    }
  }

  async function clearNotepad(options: { canRestore?: boolean } = {}) {
    const canRestore = options.canRestore ?? true;
    const note = getDocumentSession();
    const notePathToClear = note.currentNotePath;

    if (notePathToClear) {
      saveCursorPositionForDocument(note);
      saveSharedEditorStateForDocument(note);
      cancelPendingAutosave(note);
      await enqueueSave(note);
    }

    const draft = {
      title: note.title,
      bodyMarkdown: note.bodyMarkdown,
      currentNoteId: note.currentNoteId,
      currentNotePath: note.currentNotePath
    };
    const hasDraftContent = hasContent(draft);
    let forgottenPath: string | null = null;

    if (notePathToClear) {
      try {
        setNoteStatus(note, 'forgetting');
        const forgottenNoteSummary = await forgetNoteSession(
          notePathToClear,
          $forgottenNoteRetentionPreference
        );
        forgottenPath = forgottenNoteSummary?.forgottenPath ?? null;
      } catch (error) {
        console.error('Failed to forget note:', error);
        setNoteStatus(note, 'error');
        return;
      }
    }

    invalidatePendingSaveResults(note);
    cancelPendingAutosave(note);
    discardSharedEditorStateForDocument(note);
    const freshDraft = replaceReferencedNoteWithFreshDraft(notepadState, note.key);
    cleanupNoteRuntime(note.key);
    setRecentlyForgotten(
      canRestore && hasDraftContent ? createForgottenNote(draft, forgottenPath) : null
    );
    await replaceNoteAcrossPanes(note, freshDraft);
    clearSelectedRelatedText();
    scheduleSearch();
    scheduleRelated({ immediate: true });
    void loadRecentNotes();
    if (notePathToClear) {
      scheduleAutoSync('note-forgotten', 400);
    }
  }

  async function unforgetNotepad() {
    const forgottenNote = notepadState.recentlyForgotten;
    if (!forgottenNote) {
      return;
    }

    if (forgottenNote.forgottenPath) {
      try {
        const restoredNotes = await restoreForgottenNotes([forgottenNote.forgottenPath]);
        const restoredPath = restoredNotes[0]?.restoredPath;
        if (!restoredPath) {
          return;
        }

        const previousNote = getDocumentSession();
        const restoredNote = adoptSnapshotForPane(
          notepadState,
          activePaneId,
          await openNoteSession(null, restoredPath)
        );
        setRecentlyForgotten(null);
        await replaceNoteAcrossPanes(previousNote, restoredNote, { restoreCursor: true });
        clearSelectedRelatedText();
        scheduleSearch();
        scheduleRelated({ immediate: true });
        void loadRecentNotes();
        scheduleAutoSync('forgotten-restored', 400);
        return;
      } catch (error) {
        console.error('Failed to restore forgotten note:', error);
        return;
      }
    }

    const note = getDocumentSession();
    applySnapshotToNote(note, {
      ...forgottenNote,
      lastSavedTitle: '',
      lastSavedMarkdown: '',
      lastSavedNoteId: null,
      lastSavedPath: null
    });
    setRecentlyForgotten(null);
    await replaceEditorContent(note.bodyMarkdown);
    scheduleAutosave(note);
    clearSelectedRelatedText();
    scheduleSearch();
    scheduleRelated({ immediate: true });
    void loadRecentNotes();
    scheduleAutoSync('forgotten-restored-draft', 400);
  }

  function resolveRememberAction(actionId: string): RememberActionOption {
    return (
      $rememberActionOptions.find((option) => option.id === actionId) ??
      $rememberActionOptions.find((option) => option.id === 'exact') ??
      EXACT_REMEMBER_ACTION
    );
  }

  const defaultRememberShortcutAction = $derived.by(() =>
    resolveRememberAction($defaultRememberActionPreference)
  );

  async function rememberCurrentNote(action: RememberActionOption) {
    flushAllPendingDocumentSyncs();
    flushAllPendingCursorSaves();
    const resolvedAction =
      rememberActionRequiresIntegrateSupport(action) && !canIntegrate()
        ? resolveRememberAction('exact')
        : action;
    const note = getDocumentSession();
    saveCursorPositionForDocument(note);
    saveSharedEditorStateForDocument(note);
    cancelPendingAutosave(note);
    await getNoteSaveQueue(note.key);
    const operationRevision = note.operationRevision;
    setNoteStatus(note, 'remembering');

    await rememberWithAction(
      resolvedAction,
      $cleanUpApplyPolicyPreference,
      note.title,
      note.bodyMarkdown,
      note.currentNotePath
    );

    if (note.operationRevision !== operationRevision) {
      return;
    }

    scheduleAutoSync('note-remembered', 400);
    setRecentlyForgotten(null);
    invalidatePendingSaveResults(note);
    cancelPendingAutosave(note);
    discardSharedEditorStateForDocument(note);
    const freshDraft = replaceReferencedNoteWithFreshDraft(notepadState, note.key);
    await replaceNoteAcrossPanes(note, freshDraft);
    clearSearch();
    clearSelectedRelatedText();
    scheduleSearch();
    scheduleRelated({ immediate: true });
    void loadRecentNotes();
  }

  async function openNotePath(
    notePath: string | null,
    options: { noteId?: string | null; currentNoteAlreadySaved?: boolean } = {}
  ) {
    flushAllPendingDocumentSyncs();
    flushAllPendingCursorSaves();
    const paneId = activePaneId;
    const previousDocument = getPaneDocumentSession(paneId);
    if (!options.noteId && !notePath) {
      return;
    }

    saveCursorPositionForDocument(previousDocument);
    saveSharedEditorStateForDocument(previousDocument);
    if (
      !(
        options.currentNoteAlreadySaved ?? hasCurrentProposalReview
      ) &&
      (previousDocument.currentNoteId !== (options.noteId ?? null) ||
        previousDocument.currentNotePath !== notePath)
    ) {
      cancelPendingAutosave(previousDocument);
      void enqueueSave(previousDocument);
    }

    const requestGeneration = (openNoteRequestGenerationByPane.get(paneId) ?? 0) + 1;
    openNoteRequestGenerationByPane.set(paneId, requestGeneration);
    setNoteStatus(previousDocument, 'opening');

    const session = await openNoteSession(options.noteId ?? null, notePath);
    if ((openNoteRequestGenerationByPane.get(paneId) ?? 0) !== requestGeneration) {
      return;
    }

    const nextDocument = adoptSnapshotForPane(notepadState, paneId, session);
    setRecentlyForgotten(null);
    closeWikilinkAutocomplete(paneId);
    clearSelectedRelatedText();

    if (
      paneStates[paneId].isEditorReady &&
      getPaneKind(paneId) === 'editor' &&
      getPaneController(paneId)
    ) {
      if (!(await restoreSharedEditorStateForDocument(nextDocument))) {
        await replaceNoteAcrossPanes(previousDocument, nextDocument, { restoreCursor: true });
      } else {
        markPaneDocumentGeneration(paneId, nextDocument);
      }
    }

    setNoteStatus(nextDocument, 'idle');
    if (!getNoteByKey(previousDocument.key)) {
      cleanupNoteRuntime(previousDocument.key);
    }
    scheduleRelated({ immediate: true });
  }

  let currentProposalChanges = $derived.by(() =>
    getProposalChangesForPath($activeProposalSession, documentSession.currentNotePath)
  );
  let currentProposalUpdate = $derived.by<ReviewUpdateChange | null>(() => {
    const update = currentProposalChanges.find(
      (reviewChange): reviewChange is ReviewUpdateChange => reviewChange.kind === 'updateNote'
    );
    return update ?? null;
  });
  let currentProposalPreview = $derived.by(() => {
    if (!currentProposalUpdate) {
      return null;
    }

    return {
      title: currentProposalUpdate.titleSelected
        ? currentProposalUpdate.proposedTitle
        : currentProposalUpdate.currentTitle,
      markdown: applySelectedHunks(
        currentProposalUpdate.currentMarkdown,
        currentProposalUpdate.hunks.filter((hunk) => hunk.selected)
      )
    };
  });
  let hasCurrentProposalReview = $derived(currentProposalChanges.length > 0);
  let isCurrentNoteUnderProposal = $derived(hasCurrentProposalReview);

  function getProposalChangesForDocument(document: NoteDraftState) {
    return getProposalChangesForPath($activeProposalSession, document.currentNotePath);
  }

  function isDocumentUnderProposal(document: NoteDraftState) {
    return getProposalChangesForDocument(document).length > 0;
  }

  function getPaneDisplayTitle(paneId: PaneId) {
    const paneDocument = getPaneDocumentSession(paneId);
    const proposalChanges = getProposalChangesForDocument(paneDocument);
    const proposalUpdate = proposalChanges.find(
      (reviewChange): reviewChange is ReviewUpdateChange => reviewChange.kind === 'updateNote'
    );

    if (!proposalUpdate) {
      return paneDocument.title;
    }

    return proposalUpdate.titleSelected
      ? proposalUpdate.proposedTitle
      : proposalUpdate.currentTitle;
  }

  function handleActiveWikilinkChange(paneId: PaneId, nextActiveWikilink: ActiveWikilink | null) {
    paneControllers[paneId].wikilinkController.handleActiveWikilinkChange(nextActiveWikilink);
  }

  function handleWikilinkKeydown(event: KeyboardEvent) {
    if (splitPickerPaneId !== null) {
      return false;
    }

    return paneControllers[getNavigationPaneId()].wikilinkController.handleAutocompleteKeydown(event);
  }

  async function openWikilink(paneId: PaneId, rawTarget: string) {
    activePaneId = paneId;
    await paneControllers[paneId].wikilinkController.openWikilink(rawTarget);
  }

  function handleWikilinkSuggestionSelect(paneId: PaneId, value: string) {
    const state = paneStates[paneId].wikilinkAutocomplete;
    const nextIndex = state.suggestions.findIndex((suggestion) => suggestion.value === value);
    if (nextIndex === -1) {
      return;
    }

    updatePaneWikilinkState(paneId, {
      ...state,
      selectedIndex: nextIndex
    });
    paneControllers[paneId].wikilinkController.selectWikilinkSuggestion(value);
  }

  function updateRelatedDrawerLayout() {
    updateRelatedDrawerLayoutController(workspaceShell);
  }

  function clearSelectedRelatedText() {
    clearSelectedRelatedTextController();
  }

  function updateSelectedRelatedText(paneId: PaneId = getNavigationPaneId()) {
    if (splitPickerPaneId === paneId) {
      clearSelectedRelatedText();
      return;
    }

    if (getPaneKind(paneId) !== 'editor') {
      clearSelectedRelatedText();
      return;
    }

    updateSelectedRelatedTextController(getPaneEditorRoot(paneId));
  }

  function toggleRelatedPanel() {
    toggleRelatedPanelController(workspaceShell);
  }

  async function ensurePaneEditors() {
    for (const paneId of [PRIMARY_PANE_ID, SECONDARY_PANE_ID] as const) {
      const shouldMount =
        paneOrder.includes(paneId) &&
        getPaneKind(paneId) === 'editor' &&
        splitPickerPaneId !== paneId;
      const controller = getPaneController(paneId);
      const paneDocument = getPaneDocumentSession(paneId);

      if (shouldMount && !controller && getPaneEditorRoot(paneId)) {
        await paneControllers[paneId].editorLifecycleController.createEditor(paneDocument.bodyMarkdown);
        paneControllers[paneId].editorLifecycleController.restoreCursorPositionForDocument(
          paneDocument
        );
        markPaneDocumentGeneration(paneId, paneDocument);
        continue;
      }

      if (!shouldMount && controller) {
        paneControllers[paneId].editorLifecycleController.saveCursorPositionForDocument(paneDocument);
        if (paneStates[paneId].editorGeneration >= getSharedEditorStateGeneration(paneDocument)) {
          saveSharedEditorStateForDocument(paneDocument, readEditorState(controller), paneId);
        }
        await paneControllers[paneId].editorLifecycleController.destroyEditor();
        paneStates[paneId].isEditorReady = false;
        closeWikilinkAutocomplete(paneId);
      }
    }
  }

  function activatePane(paneId: PaneId) {
    flushDocumentEditorSync(getPaneDocumentSession(paneId));
    activatePaneSession(paneId);
    updateSelectedRelatedText(paneId);
    if ($searchState.searchQuery.trim() !== '') {
      scheduleSearch();
    }
    scheduleRelated({ immediate: true });
  }

  async function splitWorkspace() {
    if (paneOrder.length === 2) {
      activatePaneSession(SECONDARY_PANE_ID);
      await tick();
      focusPaneAfterShortcut(SECONDARY_PANE_ID, {
        preferTitle: document.activeElement === getPaneTitleInput(activePaneId)
      });
      return;
    }

    const sourcePaneId = paneOrder[0] ?? activePaneId;
    const targetPaneId =
      sourcePaneId === PRIMARY_PANE_ID ? SECONDARY_PANE_ID : PRIMARY_PANE_ID;
    const sharedDocument = getPaneDocumentSession(sourcePaneId);

    await loadRecentNotes();

    const placeholderDraft = createFreshDraftNote(notepadState);
    setStoredPaneKind(notepadState, targetPaneId, 'editor');
    setPaneDocumentSession(targetPaneId, placeholderDraft);
    splitPickerPaneId = targetPaneId;
    splitPickerSourceNoteKey = sharedDocument.key;
    splitPickerHighlightedIndex = 0;

    paneOrder = [PRIMARY_PANE_ID, SECONDARY_PANE_ID];
    activatePaneSession(targetPaneId);
    await tick();
    await ensurePaneEditors();
    updateSelectedRelatedText(targetPaneId);
    splitPickerFocusEl?.focus({ preventScroll: true });
  }

  async function closePane(paneId: PaneId) {
    if (paneOrder.length === 1) {
      return;
    }

    const wasSplitPicker = splitPickerPaneId === paneId;
    const orphanPlaceholderKey = wasSplitPicker ? getPaneDocumentSession(paneId).key : null;

    paneOrder = paneOrder.filter((candidate) => candidate !== paneId);

    if (wasSplitPicker) {
      splitPickerPaneId = null;
      splitPickerSourceNoteKey = null;
      splitPickerHighlightedIndex = 0;
      splitPickerFocusEl = null;
      const anchorPane = (paneOrder[0] ?? PRIMARY_PANE_ID) as PaneId;
      setPaneDocumentSession(paneId, getPaneDocumentSession(anchorPane));
      setStoredPaneKind(notepadState, paneId, 'editor');
      if (orphanPlaceholderKey) {
        removeNoteIfUnreferenced(notepadState, orphanPlaceholderKey);
        cleanupNoteRuntime(orphanPlaceholderKey);
      }
    }

    if (getPaneController(paneId)) {
      await ensurePaneEditors();
    }

    activatePaneSession((paneOrder[0] ?? PRIMARY_PANE_ID) as PaneId);
    updateSelectedRelatedText();
  }

  function getNextPaneId(paneId: PaneId = activePaneId, direction: 1 | -1 = 1) {
    if (paneOrder.length < 2) {
      return null;
    }

    const currentIndex = paneOrder.indexOf(paneId);
    if (currentIndex === -1) {
      return paneOrder[0] ?? null;
    }

    const nextIndex = (currentIndex + direction + paneOrder.length) % paneOrder.length;
    return paneOrder[nextIndex] ?? null;
  }

  function focusPaneAfterShortcut(paneId: PaneId, options: { preferTitle?: boolean } = {}) {
    if (splitPickerPaneId === paneId && splitPickerFocusEl) {
      splitPickerFocusEl.focus({ preventScroll: true });
      return;
    }

    const titleInput = getPaneTitleInput(paneId);
    if (options.preferTitle && titleInput) {
      focusInputAtEnd(titleInput);
      return;
    }

    const proseMirror = findProseMirrorElement(getPaneEditorRoot(paneId));
    if (proseMirror instanceof HTMLElement) {
      proseMirror.focus({ preventScroll: true });
      return;
    }

    titleInput?.focus();
  }

  function moveSplitPickerHighlight(direction: 1 | -1) {
    const hasPrev = splitPickerPreviousItem !== null;
    const slots = hasPrev ? [0, 1, 2] : [0, 2];
    const position = Math.max(0, slots.indexOf(splitPickerHighlightedIndex));
    splitPickerHighlightedIndex =
      slots[(position + direction + slots.length) % slots.length] ?? 0;
  }

  async function confirmSplitPickerChoiceByHighlight() {
    const paneId = splitPickerPaneId;
    if (!paneId) {
      return;
    }

    const hasPrev = splitPickerPreviousItem !== null;
    if (splitPickerHighlightedIndex === 0) {
      await resolveSplitPickerChoice(paneId, 'current');
    } else if (splitPickerHighlightedIndex === 1 && hasPrev) {
      await resolveSplitPickerChoice(paneId, 'previous');
    } else if (splitPickerHighlightedIndex === 2) {
      await resolveSplitPickerChoice(paneId, 'chat');
    }
  }

  function handleSplitPickerGlobalKeydown(event: KeyboardEvent): boolean {
    if (splitPickerPaneId === null || activePaneId !== splitPickerPaneId || event.repeat) {
      return false;
    }

    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return false;
    }

    if (target instanceof HTMLElement && target.closest('[data-notepad-bottom-bar]')) {
      return false;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }

    const hasPrev = splitPickerPreviousItem !== null;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSplitPickerHighlight(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSplitPickerHighlight(-1);
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmSplitPickerChoiceByHighlight();
      return true;
    }

    if (event.key === '1') {
      event.preventDefault();
      void resolveSplitPickerChoice(splitPickerPaneId, 'current');
      return true;
    }

    if (event.key === '2') {
      if (!hasPrev) {
        return false;
      }

      event.preventDefault();
      void resolveSplitPickerChoice(splitPickerPaneId, 'previous');
      return true;
    }

    if (event.key === '3') {
      event.preventDefault();
      void resolveSplitPickerChoice(splitPickerPaneId, 'chat');
      return true;
    }

    return false;
  }

  async function resolveSplitPickerChoice(
    paneId: PaneId,
    choice: 'current' | 'previous' | 'chat'
  ) {
    if (splitPickerPaneId !== paneId) {
      return;
    }

    const sourceKey = splitPickerSourceNoteKey;
    const previousItem = splitPickerPreviousItem;
    const placeholderKey = getPaneDocumentSession(paneId).key;

    splitPickerPaneId = null;
    splitPickerSourceNoteKey = null;
    splitPickerHighlightedIndex = 0;
    splitPickerFocusEl = null;

    activatePaneSession(paneId);

    if (choice === 'current') {
      if (!sourceKey) {
        return;
      }

      const shared = getNoteByKey(sourceKey);
      if (!shared) {
        return;
      }

      setStoredPaneKind(notepadState, paneId, 'editor');
      setPaneDocumentSession(paneId, shared);
      removeNoteIfUnreferenced(notepadState, placeholderKey);
      cleanupNoteRuntime(placeholderKey);
      await tick();
      await ensurePaneEditors();
      flushDocumentEditorSync(shared);
      updateSelectedRelatedText(paneId);
      if ($searchState.searchQuery.trim() !== '') {
        scheduleSearch();
      }

      scheduleRelated({ immediate: true });
      return;
    }

    if (choice === 'previous') {
      if (!previousItem) {
        return;
      }

      setStoredPaneKind(notepadState, paneId, 'editor');
      if (previousItem.notePath) {
        await openNotePath(previousItem.notePath, { noteId: previousItem.noteId ?? null });
      } else {
        await openSearchResult(getOpenContext(), getNavigationContext(paneId), previousItem);
      }

      await tick();
      await ensurePaneEditors();
      updateSelectedRelatedText(paneId);
      if ($searchState.searchQuery.trim() !== '') {
        scheduleSearch();
      }

      scheduleRelated({ immediate: true });
      return;
    }

    setStoredPaneKind(notepadState, paneId, 'chat');
    const chatDraft = createFreshDraftNote(notepadState);
    setPaneDocumentSession(paneId, chatDraft);
    removeNoteIfUnreferenced(notepadState, placeholderKey);
    cleanupNoteRuntime(placeholderKey);
    await tick();
    await ensurePaneEditors();
    updateSelectedRelatedText(paneId);
    if ($searchState.searchQuery.trim() !== '') {
      scheduleSearch();
    }

    scheduleRelated({ immediate: true });
  }

  async function switchActivePane(direction: 1 | -1 = 1) {
    const currentPaneId = activePaneId;
    const nextPaneId = getNextPaneId(currentPaneId, direction);
    if (!nextPaneId) {
      return;
    }

    const preferTitle = document.activeElement === getPaneTitleInput(currentPaneId);
    activatePane(nextPaneId);
    await tick();
    focusPaneAfterShortcut(nextPaneId, { preferTitle });
  }

  async function setPaneKind(paneId: PaneId, kind: PaneKind) {
    if (kind === getPaneKind(paneId)) {
      return;
    }

    const document = getPaneDocumentSession(paneId);
    setStoredPaneKind(notepadState, paneId, kind);
    activatePaneSession(paneId);
    await tick();
    await ensurePaneEditors();
    flushDocumentEditorSync(document);
    updateSelectedRelatedText();
  }

  async function handleBottomBarCommand(command: string) {
    const normalized = command.trim().toLowerCase();
    switch (normalized) {
      case '/chat':
        clearSearch();
        await setPaneKind(activePaneId, 'chat');
        return true;
      case '/edit':
        clearSearch();
        await setPaneKind(activePaneId, 'editor');
        return true;
      default:
        return false;
    }
  }

  function getPaneTitlePlaceholder(kind: PaneKind) {
    return kind === 'editor' ? 'Title' : 'Chat title';
  }

  function getPaneFrameClass(paneId: PaneId) {
    return `relative flex min-h-0 flex-1 overflow-hidden ${
      activePaneId === paneId ? 'z-10' : 'z-0'
    }`;
  }

  function getPaneBodyClass(paneId: PaneId) {
    return `relative flex min-h-0 flex-1 flex-col ${activePaneId === paneId ? 'z-10' : 'z-0'}`;
  }

  onMount(() => {
    let mounted = true;
    const unregisterPendingNoteSaveHandler = registerPendingNoteSaveHandler(async () => {
      flushAllPendingDocumentSyncs();
      flushAllPendingCursorSaves();
      cancelPendingAutosave();
      await enqueueSave();
      await Promise.all([...noteSaveQueues.values()]);
    });
    const shellResizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updateRelatedDrawerLayout();
          });

    setSlashMenuListener((view, snapshot) => {
      const paneKey = getPaneIdForSlashMenuView(view);
      if (paneKey === PRIMARY_PANE_ID) {
        applySlashMenuSnapshotForPane(PRIMARY_PANE_ID, snapshot, view);
      } else if (paneKey === SECONDARY_PANE_ID) {
        applySlashMenuSnapshotForPane(SECONDARY_PANE_ID, snapshot, view);
      }
    });

    (async () => {
      await tick();
      if (!mounted || !primaryEditorRoot) return;
      await Promise.all([loadSavedNote(), loadAssetRoot(), loadRememberCapabilities()]);
      if (!mounted || !primaryEditorRoot) return;
      try {
        await ensurePaneEditors();
        updateRelatedDrawerLayout();
        scheduleRelated({ immediate: true });
        const pendingTaskTarget = consumePendingTaskTarget();
        if (pendingTaskTarget) {
          await navigateToPendingTaskTarget(getNavigationContext(), pendingTaskTarget);
        }
        vaultNoteChangeUnlisten = await listen<VaultNoteChangeEvent>(
          'vault-note-changed',
          ({ payload }) => {
            void handleVaultNoteChanged(payload);
          }
        );
        scheduleAutoSync('notepad-mounted', 900);
      } catch (err) {
        console.error('Notepad init failed:', err);
      }
    })();

    if (workspaceShell && shellResizeObserver) {
      shellResizeObserver.observe(workspaceShell);
    }

    return () => {
      setSlashMenuListener(null);
      mounted = false;
      flushAllPendingDocumentSyncs();
      flushAllPendingCursorSaves();
      saveCursorPositionForDocument();
      saveSharedEditorStateForDocument();
      flushPendingAutosave();
      paneControllers[PRIMARY_PANE_ID].editorLifecycleController.dispose();
      paneControllers[SECONDARY_PANE_ID].editorLifecycleController.dispose();
      cancelScheduledAutoSync();
      syncCurrentFileSearchHighlights('', 'all');
      searchState.dispose();
      relatedState.dispose();
      unregisterPendingNoteSaveHandler();
      vaultNoteChangeUnlisten?.();
      vaultNoteChangeUnlisten = null;
      shellResizeObserver?.disconnect();
      for (const noteKey of [...noteSaveTimers.keys()]) {
        cleanupNoteRuntime(noteKey);
      }
      void paneControllers[PRIMARY_PANE_ID].editorLifecycleController.destroyEditor();
      void paneControllers[SECONDARY_PANE_ID].editorLifecycleController.destroyEditor();
    };
  });

  function attachPaneSelectionTracking(
    paneId: PaneId,
    isEditorReady: boolean,
    editorRoot: HTMLDivElement | null
  ) {
    if (!isEditorReady || !editorRoot) {
      return;
    }

    const proseMirror = findProseMirrorElement(editorRoot);
    if (!(proseMirror instanceof HTMLElement)) {
      return;
    }

    const persistCursorPosition = () => {
      schedulePaneCursorSave(paneId);
    };

    const handleSelectionChange = () => {
      if (activePaneId !== paneId) {
        return;
      }

      updateSelectedRelatedText(paneId);
    };

    for (const eventName of proseMirrorInteractionEvents) {
      proseMirror.addEventListener(eventName, persistCursorPosition);
      proseMirror.addEventListener(eventName, handleSelectionChange);
    }
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      flushPaneCursorSave(paneId);
      for (const eventName of proseMirrorInteractionEvents) {
        proseMirror.removeEventListener(eventName, persistCursorPosition);
        proseMirror.removeEventListener(eventName, handleSelectionChange);
      }
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }

  $effect(() => attachPaneSelectionTracking(PRIMARY_PANE_ID, paneStates[PRIMARY_PANE_ID].isEditorReady, primaryEditorRoot));
  $effect(() => attachPaneSelectionTracking(SECONDARY_PANE_ID, paneStates[SECONDARY_PANE_ID].isEditorReady, secondaryEditorRoot));
</script>

<svelte:window onkeydowncapture={handleGlobalKeydown} onfocus={handleWindowFocus} onresize={handleWindowResize} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<div bind:this={workspaceShell} class="notepad-shell relative h-full w-full min-h-0 overflow-visible">
  <div
    class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-y border-border text-card-foreground shadow-sm sm:rounded-[2rem] sm:border"
    style={getCardStyle($relatedState.panelPlacement, $relatedState.reservedWidth)}
  >
    <div class="pointer-events-none absolute inset-0 bg-card/55 backdrop-blur-xl"></div>

    {#if paneOrder.length === 2}
      <div
        class={`pointer-events-none absolute top-0 bottom-0 z-20 hidden w-1/2 border-2 border-border rounded-t-[2rem] sm:block ${
          activePaneId === PRIMARY_PANE_ID
            ? 'left-0'
            : 'right-0'
        }`}
      ></div>
    {/if}

    <div class="relative z-10 flex min-h-0 flex-1 gap-0 px-0 pt-0">
      {#if paneOrder.includes(PRIMARY_PANE_ID)}
        <div
          bind:this={primaryPaneCard}
          class={getPaneBodyClass(PRIMARY_PANE_ID)}
          role="group"
          aria-label="Primary pane"
          onpointerdown={() => activatePane(PRIMARY_PANE_ID)}
          onfocusin={() => activatePane(PRIMARY_PANE_ID)}
        >
          <div class={getPaneFrameClass(PRIMARY_PANE_ID)}>
            <div class="absolute inset-x-0 top-0 z-20">
              <div class="pointer-events-none absolute inset-0 bg-card/58 backdrop-blur-sm" style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%);"></div>
              <div class="relative z-10 flex items-center justify-between gap-3 px-4 pt-4 pb-3">
                <div class="h-9 w-9 shrink-0" aria-hidden="true"></div>
                <div class="pointer-events-none absolute inset-x-16 top-4 flex justify-center">
                  <div bind:this={primaryTitleShell} class="pointer-events-auto w-full max-w-[24rem] min-w-0">
                    <input
                      bind:this={primaryTitleInput}
                      type="text"
                      class={`w-full bg-transparent text-center text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/55 sm:text-2xl ${
                        isDocumentUnderProposal(getPaneDocumentSession(PRIMARY_PANE_ID))
                          ? 'cursor-default text-muted-foreground'
                          : ''
                      }`}
                      placeholder={getPaneTitlePlaceholder(getPaneKind(PRIMARY_PANE_ID))}
                      value={getPaneDisplayTitle(PRIMARY_PANE_ID)}
                      readonly={isDocumentUnderProposal(getPaneDocumentSession(PRIMARY_PANE_ID)) ||
                        splitPickerPaneId === PRIMARY_PANE_ID}
                      oninput={(event) => handleTitleInput(PRIMARY_PANE_ID, event)}
                      onblur={handleTitleBlur}
                      onkeydown={handleTitleKeydown}
                    />
                  </div>
                </div>
                {#if paneOrder.length > 1}
                  <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onclick={() => void closePane(PRIMARY_PANE_ID)} aria-label="Close pane">
                    <X class="h-4 w-4" />
                  </button>
                {:else}
                  <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onclick={() => void splitWorkspace()} aria-label="Add pane">
                    <Columns2 class="h-4 w-4" />
                  </button>
                {/if}
              </div>
            </div>

            {#if splitPickerPaneId === PRIMARY_PANE_ID}
              <div class="flex min-h-0 flex-1">
                <SplitPaneContentPicker
                  bind:focusRoot={splitPickerFocusEl}
                  highlightedIndex={splitPickerHighlightedIndex}
                  currentNoteLabel={splitPickerCurrentNoteLabel}
                  previousNoteLabel={splitPickerPreviousNoteLabel}
                  onHighlightChange={(index) => {
                    splitPickerHighlightedIndex = index;
                  }}
                  onChoose={(choice) => void resolveSplitPickerChoice(PRIMARY_PANE_ID, choice)}
                />
              </div>
            {:else if getPaneKind(PRIMARY_PANE_ID) === 'editor'}
              <div class="flex-1 min-h-0">
                <div
                  bind:this={primaryEditorShell}
                  class="notepad-editor-shell relative h-full"
                  class:notepad-editor-shell--slash-open={paneStates[PRIMARY_PANE_ID].slashMenu.open}
                >
                  {#if !paneStates[PRIMARY_PANE_ID].isEditorReady}
                    <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                      <span class="rounded-full bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
                        Loading editor
                      </span>
                    </div>
                  {/if}

                  <div bind:this={primaryEditorRoot} class={`min-h-full ${isDocumentUnderProposal(getPaneDocumentSession(PRIMARY_PANE_ID)) ? 'hidden' : ''}`}></div>
                  {#if isDocumentUnderProposal(getPaneDocumentSession(PRIMARY_PANE_ID))}
                    <section class="mx-auto min-h-full w-full max-w-3xl px-4 pt-28 pb-16 sm:px-8">
                      {#if proposalErrorMessage}
                        <div class="mb-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                          {proposalErrorMessage}
                        </div>
                      {/if}
                      <ProposalReviewList
                        reviewChanges={getProposalChangesForDocument(getPaneDocumentSession(PRIMARY_PANE_ID))}
                        compact={true}
                        minimal={true}
                        showSegmentControls={false}
                        framelessPreview={true}
                        showRemovedContent={false}
                        emptyMessage="No proposed edits are attached to this note."
                        onToggleChange={toggleProposalChange}
                        onToggleHunk={toggleProposalHunk}
                        onToggleTitle={toggleProposalTitle}
                      />
                    </section>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="flex min-h-0 flex-1 items-center justify-center px-6 pt-28 pb-16">
                <div class="max-w-md rounded-[1.6rem] border border-border/70 bg-background/60 px-6 py-5 text-left shadow-sm">
                  <div class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">LLM Chat</div>
                  <p class="mt-3 text-sm leading-7 text-muted-foreground">
                    Chat panes are scaffolded for the multipane layout. This pane already tracks focus, title chrome, and close behavior, but the actual chat experience is still a placeholder in this pass.
                  </p>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if paneOrder.includes(SECONDARY_PANE_ID)}
        <div
          bind:this={secondaryPaneCard}
          class={getPaneBodyClass(SECONDARY_PANE_ID)}
          role="group"
          aria-label="Secondary pane"
          onpointerdown={() => activatePane(SECONDARY_PANE_ID)}
          onfocusin={() => activatePane(SECONDARY_PANE_ID)}
        >
          <div class={getPaneFrameClass(SECONDARY_PANE_ID)}>
            <div class="absolute inset-x-0 top-0 z-20">
              <div class="pointer-events-none absolute inset-0 bg-card/58 backdrop-blur-sm" style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%);"></div>
              <div class="relative z-10 flex items-center justify-between gap-3 px-4 pt-4 pb-3">
                <div class="h-9 w-9 shrink-0" aria-hidden="true"></div>
                <div class="pointer-events-none absolute inset-x-16 top-4 flex justify-center">
                  <div bind:this={secondaryTitleShell} class="pointer-events-auto w-full max-w-[24rem] min-w-0">
                    <input
                      bind:this={secondaryTitleInput}
                      type="text"
                      class={`w-full bg-transparent text-center text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/55 sm:text-2xl ${
                        isDocumentUnderProposal(getPaneDocumentSession(SECONDARY_PANE_ID))
                          ? 'cursor-default text-muted-foreground'
                          : ''
                      }`}
                      placeholder={getPaneTitlePlaceholder(getPaneKind(SECONDARY_PANE_ID))}
                      value={getPaneDisplayTitle(SECONDARY_PANE_ID)}
                      readonly={isDocumentUnderProposal(getPaneDocumentSession(SECONDARY_PANE_ID)) ||
                        splitPickerPaneId === SECONDARY_PANE_ID}
                      oninput={(event) => handleTitleInput(SECONDARY_PANE_ID, event)}
                      onblur={handleTitleBlur}
                      onkeydown={handleTitleKeydown}
                    />
                  </div>
                </div>
                {#if paneOrder.length > 1}
                  <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onclick={() => void closePane(SECONDARY_PANE_ID)} aria-label="Close pane">
                    <X class="h-4 w-4" />
                  </button>
                {:else}
                  <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onclick={() => void splitWorkspace()} aria-label="Add pane">
                    <Columns2 class="h-4 w-4" />
                  </button>
                {/if}
              </div>
            </div>

            {#if splitPickerPaneId === SECONDARY_PANE_ID}
              <div class="flex min-h-0 flex-1">
                <SplitPaneContentPicker
                  bind:focusRoot={splitPickerFocusEl}
                  highlightedIndex={splitPickerHighlightedIndex}
                  currentNoteLabel={splitPickerCurrentNoteLabel}
                  previousNoteLabel={splitPickerPreviousNoteLabel}
                  onHighlightChange={(index) => {
                    splitPickerHighlightedIndex = index;
                  }}
                  onChoose={(choice) => void resolveSplitPickerChoice(SECONDARY_PANE_ID, choice)}
                />
              </div>
            {:else if getPaneKind(SECONDARY_PANE_ID) === 'editor'}
              <div class="flex-1 min-h-0">
                <div
                  bind:this={secondaryEditorShell}
                  class="notepad-editor-shell relative h-full"
                  class:notepad-editor-shell--slash-open={paneStates[SECONDARY_PANE_ID].slashMenu.open}
                >
                  {#if !paneStates[SECONDARY_PANE_ID].isEditorReady}
                    <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                      <span class="rounded-full bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
                        Loading editor
                      </span>
                    </div>
                  {/if}

                  <div bind:this={secondaryEditorRoot} class={`min-h-full ${isDocumentUnderProposal(getPaneDocumentSession(SECONDARY_PANE_ID)) ? 'hidden' : ''}`}></div>
                  {#if isDocumentUnderProposal(getPaneDocumentSession(SECONDARY_PANE_ID))}
                    <section class="mx-auto min-h-full w-full max-w-3xl px-4 pt-28 pb-16 sm:px-8">
                      <ProposalReviewList
                        reviewChanges={getProposalChangesForDocument(getPaneDocumentSession(SECONDARY_PANE_ID))}
                        compact={true}
                        minimal={true}
                        showSegmentControls={false}
                        framelessPreview={true}
                        showRemovedContent={false}
                        emptyMessage="No proposed edits are attached to this note."
                        onToggleChange={toggleProposalChange}
                        onToggleHunk={toggleProposalHunk}
                        onToggleTitle={toggleProposalTitle}
                      />
                    </section>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="flex min-h-0 flex-1 items-center justify-center px-6 pt-28 pb-16">
                <div class="max-w-md rounded-[1.6rem] border border-border/70 bg-background/60 px-6 py-5 text-left shadow-sm">
                  <div class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">LLM Chat</div>
                  <p class="mt-3 text-sm leading-7 text-muted-foreground">
                    This placeholder reserves the pane contract for a future chat implementation while keeping the workspace architecture aligned around split panes and a shared note session.
                  </p>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="absolute bottom-0 left-0 right-0 z-30">
      <BottomBar
        {canUnforget}
        searchMode={$searchState.searchMode}
        searchQuery={$searchState.searchQuery}
        searchResults={$searchState.searchResults}
        recentNotes={$searchState.recentNotes}
        recentTasks={$searchState.recentTasks}
        isSearching={$searchState.isSearching}
        rememberActions={$rememberActionOptions}
        defaultRememberActionId={$defaultRememberActionPreference}
        integrateEnabled={canIntegrate()}
        integrateDisabledReason={integrateDisabledReason()}
        focusRequest={$searchState.focusRequest}
        onForget={() => void clearNotepad()}
        onUnforget={() => void unforgetNotepad()}
        onRemember={(action) => void rememberCurrentNote(action)}
        onSearchInput={handleSearchInput}
        onSearchModeChange={handleSearchModeChange}
        onSearchSelect={(result) =>
          void handleSearchResultSelect(result).catch((error) => {
            console.error('Failed to open searched note:', error);
          })}
        onRecentNoteSelect={(result) =>
          void openRecentNoteItem(result).catch((error) => {
            console.error('Failed to open recent note:', error);
          })}
        onRecentTaskSelect={(task) =>
          void handleRecentTaskSelect(task).catch((error) => {
            console.error('Failed to open recent task:', error);
          })}
        onRecentNoteShortcut={(index) => void openRecentNoteByIndex(index)}
        onRecentTaskShortcut={(index) => void openRecentTaskByIndex(index)}
        onSearchFocus={handleSearchFocus}
        onCommand={(command) => handleBottomBarCommand(command)}
      />
    </div>
  </div>

  {#if $relatedState.panelPlacement === 'side'}
    <aside
      class="related-drawer absolute top-0 bottom-0 z-20 flex min-h-0 items-stretch transition-[left] duration-300"
      aria-label="Related notes panel"
      style={getRelatedDrawerStyle($relatedState.reservedWidth)}
    >
      <div class="relative h-full min-h-0 w-full">
        <button
          type="button"
          class="related-drawer-handle group absolute -mx-4 top-1/2 left-0 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center"
          aria-expanded={!$relatedState.isPanelCollapsed}
          aria-controls="related-drawer-panel"
          aria-label={$relatedState.isPanelCollapsed ? 'Expand related notes' : 'Collapse related notes'}
          onclick={toggleRelatedPanel}
        >
          <span class="related-drawer-handle-pill flex h-28 w-7 items-center justify-center rounded-full border border-border/70 bg-card/92 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground shadow-lg backdrop-blur-md transition group-hover:text-foreground">
            <span class="-rotate-90">RELATED</span>
          </span>
        </button>

        <div
          id="related-drawer-panel"
          class={`absolute inset-y-0 left-0 flex w-full min-h-0 pl-4 transition-[opacity,transform] duration-300 ease-out ${
            $relatedState.isPanelCollapsed
              ? 'pointer-events-none translate-x-3 opacity-0'
              : 'pointer-events-auto translate-x-0 opacity-100'
          }`}
        >
          <div class="my-auto max-h-full w-full">
            <RelatedPanel
              items={$relatedState.items}
              scope={$relatedState.scope}
              status={$relatedState.status}
              reason={$relatedState.reason}
              loading={$relatedState.isLoading}
              hasSelection={!!$relatedState.selectedText}
              onScopeChange={handleRelatedScopeChange}
              onSelect={(item) =>
                void handleRelatedItemSelect(item).catch((error) => {
                  console.error('Failed to open related note:', error);
                })}
            />
          </div>
        </div>
      </div>
    </aside>
  {:else}
    <div class="related-bottom-sheet pointer-events-none absolute z-20" style={getBottomSheetStyle()}>
      <div class="related-bottom-sheet-anchor pointer-events-none relative">
        <div
          aria-hidden="true"
          class={`related-bottom-sheet-backdrop ${$relatedState.isPanelCollapsed ? 'hidden' : 'block'}`}
        ></div>
        <div
          id="related-drawer-panel"
          class={`related-bottom-sheet-panel w-full overflow-hidden transition-[opacity,transform] duration-300 ease-out ${
            $relatedState.isPanelCollapsed
              ? 'pointer-events-none translate-y-0 opacity-0'
              : 'pointer-events-auto translate-y-0 opacity-100'
          }`}
        >
          <RelatedPanel
            items={$relatedState.items}
            scope={$relatedState.scope}
            status={$relatedState.status}
            reason={$relatedState.reason}
            loading={$relatedState.isLoading}
            hasSelection={!!$relatedState.selectedText}
            onScopeChange={handleRelatedScopeChange}
            onSelect={(item) =>
              void handleRelatedItemSelect(item).catch((error) => {
                console.error('Failed to open related note:', error);
              })}
          />
        </div>

        <button
          type="button"
          class="related-bottom-sheet-toggle pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-border/70 bg-card/92 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground shadow-lg backdrop-blur-md transition hover:text-foreground"
          aria-expanded={!$relatedState.isPanelCollapsed}
          aria-controls="related-drawer-panel"
          aria-label={$relatedState.isPanelCollapsed ? 'Expand related notes' : 'Collapse related notes'}
          onclick={toggleRelatedPanel}
        >
          RELATED
        </button>
      </div>
    </div>
  {/if}

  <SlashMenu menu={paneStates[PRIMARY_PANE_ID].slashMenu} boundsElement={primaryPaneCard} />
  <SlashMenu menu={paneStates[SECONDARY_PANE_ID].slashMenu} boundsElement={secondaryPaneCard} />

  <WikilinkAutocomplete
    active={paneStates[PRIMARY_PANE_ID].wikilinkAutocomplete.active}
    activeWikilink={paneStates[PRIMARY_PANE_ID].wikilinkAutocomplete.activeWikilink}
    suggestions={paneStates[PRIMARY_PANE_ID].wikilinkAutocomplete.suggestions}
    selectedIndex={paneStates[PRIMARY_PANE_ID].wikilinkAutocomplete.selectedIndex}
    onSelect={(suggestion) => handleWikilinkSuggestionSelect(PRIMARY_PANE_ID, suggestion.value)}
  />
  <WikilinkAutocomplete
    active={paneStates[SECONDARY_PANE_ID].wikilinkAutocomplete.active}
    activeWikilink={paneStates[SECONDARY_PANE_ID].wikilinkAutocomplete.activeWikilink}
    suggestions={paneStates[SECONDARY_PANE_ID].wikilinkAutocomplete.suggestions}
    selectedIndex={paneStates[SECONDARY_PANE_ID].wikilinkAutocomplete.selectedIndex}
    onSelect={(suggestion) => handleWikilinkSuggestionSelect(SECONDARY_PANE_ID, suggestion.value)}
  />
</div>

<style>
  .notepad-shell {
    --editor-left-padding: 1rem;
    --editor-right-padding: 1rem;
    --editor-readable-width: 100%;
    --editor-top-padding: 4.6rem;
    --editor-bottom-padding: calc(7rem + env(safe-area-inset-bottom, 0px));
    --related-drawer-gap: 1rem;
    --related-drawer-peek-width: 2.75rem;
    --related-bottom-offset: calc(6.1rem + env(safe-area-inset-bottom, 0px));
    overflow: visible;
  }

  @media (min-width: 640px) {
    .notepad-shell {
      --editor-left-padding: 2rem;
      --editor-right-padding: 1.4rem;
      --editor-readable-width: 40rem;
      --editor-top-padding: 5.3rem;
      --editor-bottom-padding: 100%;
    }
  }

  @media (min-width: 1280px) {
    .notepad-shell {
      --editor-left-padding: 2.8rem;
      --editor-right-padding: 1.8rem;
      --editor-readable-width: 42rem;
    }
  }

  .notepad-editor-shell {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .notepad-editor-shell.notepad-editor-shell--slash-open {
    overflow: hidden;
    overscroll-behavior: none;
    touch-action: none;
  }

  .related-drawer {
    overflow: visible;
  }

  .related-drawer-handle {
    outline: none;
  }

  .related-drawer-handle-pill {
    writing-mode: horizontal-tb;
  }

  .related-bottom-sheet {
    --related-bottom-sheet-toggle-height: 2.75rem;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-end;
    max-width: calc(100% - 1rem);
  }

  .related-bottom-sheet-anchor {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .related-bottom-sheet-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: calc(var(--related-bottom-sheet-toggle-height) + 0.75rem);
  }

  .related-bottom-sheet-backdrop {
    position: absolute;
    top: 0;
    right: 0;
    bottom: calc(var(--related-bottom-sheet-toggle-height) + 0.75rem);
    left: 0;
    border-radius: 1.8rem;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .related-bottom-sheet-toggle {
    position: absolute;
    right: 0;
    bottom: 0;
  }

  .notepad-shell,
  .notepad-editor-shell :global(.gn-editor-root) {
    --crepe-color-background: var(--card);
    --crepe-color-on-background: var(--foreground);
    --crepe-color-surface: color-mix(in oklab, var(--card) 92%, var(--background));
    --crepe-color-surface-low: color-mix(in oklab, var(--muted) 74%, var(--card));
    --crepe-color-on-surface: var(--card-foreground);
    --crepe-color-on-surface-variant: var(--muted-foreground);
    --crepe-color-outline: color-mix(in oklab, var(--border) 82%, var(--foreground));
    --crepe-color-primary: var(--foreground);
    --crepe-color-secondary: var(--accent);
    --crepe-color-on-secondary: var(--accent-foreground);
    --crepe-color-inverse: var(--foreground);
    --crepe-color-on-inverse: var(--background);
    --crepe-color-inline-code: var(--destructive);
    --crepe-color-error: var(--destructive);
    --crepe-color-hover: color-mix(in oklab, var(--accent) 82%, transparent);
    --crepe-color-selected: color-mix(in oklab, var(--accent) 92%, var(--background));
    --crepe-color-inline-area: color-mix(in oklab, var(--muted) 80%, var(--background));
    --gn-editor-selection-background: color-mix(in oklab, var(--foreground) 42%, var(--background));
    --gn-editor-selection-color: var(--background);
    --gn-task-checkbox-border: color-mix(in oklab, var(--foreground) 20%, var(--card) 80%);
    --gn-task-checkbox-bg: color-mix(in oklab, var(--card) 92%, var(--muted) 8%);
    --gn-task-checkbox-checked-border: color-mix(in oklab, var(--foreground) 28%, var(--card) 72%);
    --gn-task-checkbox-checked-bg: color-mix(in oklab, var(--foreground) 18%, var(--card) 82%);
    --gn-task-checkbox-check: color-mix(in oklab, var(--foreground) 88%, white 12%);
  }

  .notepad-editor-shell :global(.gn-editor-root) {
    min-height: 100%;
    width: 100%;
    max-width: 100%;
    overflow-x: clip;
  }

  .notepad-editor-shell :global(.gn-editor-root .notepad-block-handle [data-role='add']) {
    display: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror) {
    box-sizing: border-box;
    min-height: 100%;
    max-width: 100%;
    width: min(100%, calc(var(--editor-readable-width) + var(--editor-left-padding) + var(--editor-right-padding)));
    margin-inline: auto;
    padding-top: var(--editor-top-padding);
    padding-left: var(--editor-left-padding);
    padding-right: var(--editor-right-padding);
    padding-bottom: var(--editor-bottom-padding);
    overflow-anchor: auto;
    position: relative;
    color: var(--foreground);
    line-height: 1.75;
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror > *) {
    max-width: 100%;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror p),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ul),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ol),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror blockquote),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror pre),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror table) {
    margin: 0.65rem 0;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h1),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h2),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h3),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h4),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h5),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h6) {
    margin: 1.15rem 0 0.45rem;
    font-weight: 700;
    line-height: 1.25;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h1) { font-size: 2rem; }
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h2) { font-size: 1.6rem; }
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h3) { font-size: 1.32rem; }
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h4),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h5),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h6) { font-size: 1.08rem; }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror blockquote) {
    padding-left: 1rem;
    border-left: 3px solid color-mix(in oklab, var(--border) 82%, var(--foreground) 18%);
    color: color-mix(in oklab, var(--foreground) 78%, var(--muted-foreground) 22%);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror pre) {
    overflow-x: auto;
    padding: 0.95rem 1rem;
    border-radius: 1rem;
    border: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--muted) 76%, var(--background));
    font-family: var(--font-mono);
    font-size: 0.92rem;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror code) {
    font-family: var(--font-mono);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror p code),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror li code),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror blockquote code) {
    padding: 0.12rem 0.35rem;
    border-radius: 0.4rem;
    background: color-mix(in oklab, var(--muted) 80%, var(--background));
    color: var(--destructive);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ul),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ol) {
    padding-left: 1.4rem;
    list-style-position: outside;
  }

  /* Tailwind preflight sets list-style: none on ul/ol — restore markers in the editor */
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ul:not([data-task-list='true'])) {
    list-style-type: disc;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ol) {
    list-style-type: decimal;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ul[data-task-list='true']) {
    padding-left: 0;
    list-style: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror li[data-checked]) {
    position: relative;
    padding-left: 2.08rem;
    list-style: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror li[data-checked]::before) {
    content: '';
    position: absolute;
    left: 0;
    top: 0.28rem;
    width: 1.28rem;
    height: 1.28rem;
    border-radius: 0.24rem;
    border: 1px solid var(--gn-task-checkbox-border);
    background: var(--gn-task-checkbox-bg);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror li[data-checked='true']::before) {
    border-color: var(--gn-task-checkbox-checked-border);
    background: var(--gn-task-checkbox-checked-bg);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror li[data-checked='true']::after) {
    content: '';
    position: absolute;
    left: 0.35rem;
    top: 0.69rem;
    width: 0.6rem;
    height: 0.34rem;
    border-left: 2px solid var(--gn-task-checkbox-check);
    border-bottom: 2px solid var(--gn-task-checkbox-check);
    transform: rotate(-45deg);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .crepe-placeholder::before) {
    content: attr(data-placeholder);
    position: absolute;
    color: color-mix(in oklab, var(--muted-foreground) 82%, transparent);
    pointer-events: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror *::selection) {
    background: var(--gn-editor-selection-background);
    color: var(--gn-editor-selection-color);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-current-search-highlight) {
    border-radius: 0.28rem;
    background: color-mix(in oklab, var(--accent) 76%, var(--foreground) 24%);
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--foreground) 18%, transparent),
      0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-wikilink) {
    border-radius: 0.35rem;
    background: color-mix(in oklab, var(--accent) 54%, transparent);
    color: color-mix(in oklab, var(--foreground) 88%, var(--accent-foreground) 12%);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-thickness: 0.08em;
    text-underline-offset: 0.14em;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-image-upload-placeholder) {
    display: inline-flex;
    align-items: center;
    padding: 0.45rem 0.7rem;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--card) 92%, var(--background));
    color: color-mix(in oklab, var(--foreground) 72%, transparent);
    font-size: 0.92rem;
  }

  .notepad-editor-shell :global(.gn-editor-root .notepad-block-drop-indicator) {
    position: fixed;
    z-index: 7;
    height: 0;
    border-top: 3px solid color-mix(in oklab, var(--accent) 88%, var(--foreground) 12%);
    border-radius: 999px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 90ms ease;
  }

  .notepad-editor-shell :global(.gn-editor-root .notepad-block-drop-indicator[data-show='true']) {
    opacity: 1;
  }

</style>
