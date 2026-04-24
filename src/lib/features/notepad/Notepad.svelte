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
  import { keyboardShortcutMatchesEvent } from '$lib/keyboardShortcuts';
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
  import type { EditorView } from '@codemirror/view';
  import {
    createSharedEditorResources,
    type EditorController,
    type EditorSnapshot,
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
    storePastedImageAsset,
    type ForgottenNote,
    type SessionSnapshot
  } from '$lib/features/notepad/session/session';
  import {
    createWikilinkAutocompleteState,
    type WikilinkAutocompleteState
  } from '$lib/features/notepad/wikilinks/state';
  import {
    getNextSplitChoiceIndex,
    getSplitChoiceByIndex,
    getSplitChoiceForShortcut,
    type SplitChoice
  } from '$lib/features/notepad/splitPanePicker';
  import type { RecentTaskItem } from '$lib/features/notepad/model/types';
  import BottomBar from '$lib/features/notepad/ui/BottomBar.svelte';
  import SplitPaneContentPicker from '$lib/features/notepad/SplitPaneContentPicker.svelte';
  import SlashMenu, {
    type PaneSlashMenuModel
  } from '$lib/features/notepad/editor/SlashMenu.svelte';
  import WikilinkAutocomplete from '$lib/features/notepad/wikilinks/WikilinkAutocomplete.svelte';
  import RelatedPanel from '$lib/features/notepad/related/RelatedPanel.svelte';
  import ProposalReviewList from '$lib/features/proposals/ProposalReviewList.svelte';
  import {
    EMPTY_RELATED_REASON,
    getBottomSheetStyle,
    getCardStyle,
    getRelatedDrawerStyle
  } from '$lib/features/notepad/related/layout';
  import {
    createNotepadRefreshController,
    type VaultNoteChangeEvent
  } from '$lib/features/notepad/orchestration/notepadRefreshController';
  import {
    createPaneSessionController,
    findSplitPickerPreviousItem,
    getSplitSourceNote,
    splitPickerNoteLabel,
    splitPickerPreviousNoteLabel as buildSplitPickerPreviousNoteLabel
  } from '$lib/features/notepad/orchestration/paneSessionController';
  import { createNotepadPersistenceController } from '$lib/features/notepad/orchestration/persistenceController';
  import {
    buildProposalPreview,
    getCurrentProposalUpdate,
    getProposalChangesForDocument as getDocumentProposalChanges,
    getProposalDisplayTitle,
    isDocumentUnderProposal as isProposalDocument
  } from '$lib/features/notepad/orchestration/proposalController';
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
  import {
    documentSyncFrameIds,
    noteSaveQueues,
    noteSaveTimers,
    notepadRuntimeState,
    PRIMARY_PANE_ID,
    SECONDARY_PANE_ID,
    sharedEditorResourcesByNoteKey,
    sharedEditorStateByNoteKey,
    sharedEditorStateGenerationByNoteKey,
    updateSharedEditorResourceConfig,
    type NotepadPaneId
  } from '$lib/features/notepad/session/runtimeStore.svelte';
  import { cancelScheduledAutoSync, runAutoSyncNow, scheduleAutoSync } from '$lib/sync/autoSync';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';

  type PaneId = NotepadPaneId;
  type PaneKind = 'editor' | 'chat';
  const PENDING_MAP_NOTE_PATH_KEY = 'gneauxghts:pending-map-note-path';

  interface PaneUiState {
    isEditorReady: boolean;
    isApplyingExternalContent: boolean;
    wikilinkAutocomplete: WikilinkAutocompleteState;
    editorGeneration: number;
    slashMenu: PaneSlashMenuModel;
  }

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

  let paneOrder = $state<PaneId[]>([...notepadRuntimeState.paneOrder]);
  let activePaneId = $state<PaneId>(notepadRuntimeState.activePaneId);
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

  const notepadState = notepadRuntimeState.notepadState;
  let documentSession = $derived.by(() => getActiveNote(notepadState));
  const cursorSaveTimers = new Map<PaneId, ReturnType<typeof window.setTimeout>>();
  const openNoteRequestGenerationByPane = new Map<PaneId, number>([
    [PRIMARY_PANE_ID, 0],
    [SECONDARY_PANE_ID, 0]
  ]);

  let canUnforget = $derived(notepadState.recentlyForgotten !== null);
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;
  let semanticStatus = $state<SemanticStatus | null>(null);
  let proposalErrorMessage = $state('');
  let currentSearchHighlightMode: SearchMode = 'all';
  let currentSearchHighlightQuery = '';

  $effect(() => {
    notepadRuntimeState.paneOrder = paneOrder;
    notepadRuntimeState.activePaneId = activePaneId;
  });

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

  let splitPickerCurrentNoteLabel = $derived.by(() =>
    splitPickerNoteLabel(getSplitSourceNote(notepadState, splitPickerSourceNoteKey))
  );

  let splitPickerPreviousItem = $derived.by((): SearchItem | null => {
    if (splitPickerPaneId === null || !splitPickerSourceNoteKey) {
      return null;
    }

    return findSplitPickerPreviousItem(
      $searchState.recentNotes,
      getSplitSourceNote(notepadState, splitPickerSourceNoteKey)
    );
  });

  let splitPickerPreviousNoteLabel = $derived(
    buildSplitPickerPreviousNoteLabel(splitPickerPreviousItem)
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

  const paneSessionController = createPaneSessionController<PaneId>({
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneKind,
    getPaneDocumentSession,
    activatePaneSession,
    setPaneDocumentSession
  });

  const {
    getEditorPaneIds,
    getNavigationPaneId,
    getNextPaneId,
    getPaneIdsForDocument,
    getVisiblePaneIds
  } = paneSessionController;

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
    editorState: EditorSnapshot | null
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
      assetRootPath: notepadRuntimeState.assetRootPath,
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
    const resources = sharedEditorResourcesByNoteKey.get(noteKey);
    resources?.destroy();
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

    const runtime = sharedEditorResourcesByNoteKey.get(document.key)?.runtime;
    if ((runtime?.paneControllers.size ?? 0) > 0) {
      return;
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
    editorState: EditorSnapshot | null = null,
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
    editorState: EditorSnapshot | null
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

    if (keyboardShortcutMatchesEvent(event, 'splitWorkspace')) {
      if (event.repeat || paneOrder.length > 1) {
        return;
      }

      const preferTitle = document.activeElement === getPaneTitleInput(activePaneId);
      event.preventDefault();
      await splitWorkspace();
      focusPaneAfterShortcut(activePaneId, { preferTitle });
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'closePane')) {
      if (event.repeat || paneOrder.length < 2) {
        return;
      }

      const preferTitle = document.activeElement === getPaneTitleInput(activePaneId);
      event.preventDefault();
      await closePane(activePaneId);
      focusPaneAfterShortcut(activePaneId, { preferTitle });
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'rememberCurrentNote')) {
      if (event.repeat) {
        return;
      }

      event.preventDefault();
      await rememberCurrentNote(defaultRememberShortcutAction);
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'switchPane')) {
      if (event.repeat || paneOrder.length < 2) {
        return;
      }

      event.preventDefault();
      await switchActivePane();
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'toggleRelatedPanel')) {
      event.preventDefault();
      toggleRelatedPanel();
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'reloadCurrentNote')) {
      event.preventDefault();
      void openRecentNoteByIndex(0, { forceReload: true });
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'searchAll')) {
      event.preventDefault();
      requestSearchFocus('all');
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'searchCurrent')) {
      event.preventDefault();
      requestSearchFocus('current');
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

  const refreshController = createNotepadRefreshController({
    getDocumentSession: () => documentSession,
    refreshDerivedViews,
    updateRelatedDrawerLayout,
    runAutoSyncNow,
    scheduleAutoSync,
    refreshCurrentNoteIfChanged,
    getNoteByKey,
    getPaneIdsForDocument,
    replaceNoteAcrossPanes,
    replaceReferencedNoteWithFreshDraft: (noteKey) =>
      replaceReferencedNoteWithFreshDraft(notepadState, noteKey),
    noteKeyFromPath
  });

  const {
    handleWindowFocus,
    handleWindowResize,
    handleVisibilityChange,
    handleVaultNoteChanged
  } = refreshController;

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

  const {
    cancelPendingAutosave,
    enqueueSave,
    flushPendingAutosave,
    getNoteSaveQueue,
    hasCleanBuffer,
    invalidatePendingSaveResults,
    scheduleAutosave
  } = createNotepadPersistenceController({
    getDocumentSession,
    timers: noteSaveTimers,
    queues: noteSaveQueues,
    saveNoteSession,
    rekeyNoteWithRuntime,
    scheduleAutoSync
  });

  const paneControllers = {
    [PRIMARY_PANE_ID]: createPaneRuntime(PRIMARY_PANE_ID),
    [SECONDARY_PANE_ID]: createPaneRuntime(SECONDARY_PANE_ID)
  } as const;

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
          restoreCursor,
          suppressReadyReset: true
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
      updateSharedEditorResourceConfig(
        resolveAssetRootPath(vaultInfo.currentPath),
        storePastedImageAsset
      );
    } catch (error) {
      console.error('Failed to load vault info for image assets:', error);
      updateSharedEditorResourceConfig(null, storePastedImageAsset);
    }
  }

  function consumePendingMapNotePath() {
    const notePath = window.sessionStorage.getItem(PENDING_MAP_NOTE_PATH_KEY);
    if (!notePath) {
      return null;
    }

    window.sessionStorage.removeItem(PENDING_MAP_NOTE_PATH_KEY);
    return notePath;
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
    options: {
      noteId?: string | null;
      currentNoteAlreadySaved?: boolean;
      focusEditorAfterOpen?: boolean;
    } = {}
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
      await replaceNoteAcrossPanes(previousDocument, nextDocument, { restoreCursor: true });
    }

    if ((options.focusEditorAfterOpen ?? true) && getPaneKind(paneId) === 'editor') {
      await tick();
      focusPaneAfterShortcut(paneId, { preferTitle: false });
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
  let currentProposalUpdate = $derived.by(() => getCurrentProposalUpdate(currentProposalChanges));
  let currentProposalPreview = $derived.by(() => buildProposalPreview(currentProposalUpdate));
  let hasCurrentProposalReview = $derived(currentProposalChanges.length > 0);
  let isCurrentNoteUnderProposal = $derived(hasCurrentProposalReview);

  function getProposalChangesForDocument(document: NoteDraftState) {
    return getDocumentProposalChanges($activeProposalSession, document);
  }

  function isDocumentUnderProposal(document: NoteDraftState) {
    return isProposalDocument($activeProposalSession, document);
  }

  function getPaneDisplayTitle(paneId: PaneId) {
    return getProposalDisplayTitle($activeProposalSession, getPaneDocumentSession(paneId));
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
      resetSplitPickerState();
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
    splitPickerHighlightedIndex = getNextSplitChoiceIndex(
      splitPickerHighlightedIndex,
      direction,
      splitPickerPreviousItem !== null
    );
  }

  async function confirmSplitPickerChoiceByHighlight() {
    const paneId = splitPickerPaneId;
    if (!paneId) {
      return;
    }

    const choice = getSplitChoiceByIndex(splitPickerHighlightedIndex, splitPickerPreviousItem !== null);
    if (choice) {
      await resolveSplitPickerChoice(paneId, choice);
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

    const shortcutChoice = getSplitChoiceForShortcut(event.key, splitPickerPreviousItem !== null);
    if (shortcutChoice === null) {
      return false;
    }

    event.preventDefault();
    void resolveSplitPickerChoice(splitPickerPaneId, shortcutChoice);
    return true;
  }

  function resetSplitPickerState() {
    splitPickerPaneId = null;
    splitPickerSourceNoteKey = null;
    splitPickerHighlightedIndex = 0;
    splitPickerFocusEl = null;
  }

  async function finalizeSplitPickerSelection(paneId: PaneId) {
    await tick();
    await ensurePaneEditors();
    updateSelectedRelatedText(paneId);
    if ($searchState.searchQuery.trim() !== '') {
      scheduleSearch();
    }

    scheduleRelated({ immediate: true });
  }

  async function resolveSplitPickerChoice(paneId: PaneId, choice: SplitChoice) {
    if (splitPickerPaneId !== paneId) {
      return;
    }

    const sourceKey = splitPickerSourceNoteKey;
    const previousItem = splitPickerPreviousItem;
    const placeholderKey = getPaneDocumentSession(paneId).key;

    resetSplitPickerState();
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
      await finalizeSplitPickerSelection(paneId);
      flushDocumentEditorSync(shared);
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

      await finalizeSplitPickerSelection(paneId);
      return;
    }

    if (choice === 'new') {
      setStoredPaneKind(notepadState, paneId, 'editor');
      const newDraft = createFreshDraftNote(notepadState);
      setPaneDocumentSession(paneId, newDraft);
      removeNoteIfUnreferenced(notepadState, placeholderKey);
      cleanupNoteRuntime(placeholderKey);
      await finalizeSplitPickerSelection(paneId);
      flushDocumentEditorSync(newDraft);
      return;
    }

    setStoredPaneKind(notepadState, paneId, 'chat');
    const chatDraft = createFreshDraftNote(notepadState);
    setPaneDocumentSession(paneId, chatDraft);
    removeNoteIfUnreferenced(notepadState, placeholderKey);
    cleanupNoteRuntime(placeholderKey);
    await finalizeSplitPickerSelection(paneId);
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
      if (notepadRuntimeState.hasLoadedInitialSession) {
        await Promise.all([loadAssetRoot(), loadRememberCapabilities()]);
      } else {
        await Promise.all([loadSavedNote(), loadAssetRoot(), loadRememberCapabilities()]);
        notepadRuntimeState.hasLoadedInitialSession = true;
      }
      if (!mounted || !primaryEditorRoot) return;
      try {
        await ensurePaneEditors();
        updateRelatedDrawerLayout();
        scheduleRelated({ immediate: true });
        const pendingMapNotePath = consumePendingMapNotePath();
        if (pendingMapNotePath) {
          await openNotePath(pendingMapNotePath, { focusEditorAfterOpen: false });
        }
        const pendingTaskTarget = consumePendingTaskTarget();
        if (pendingTaskTarget) {
          await openNotePath(pendingTaskTarget.notePath, {
            noteId: pendingTaskTarget.noteId,
            focusEditorAfterOpen: false
          });
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
    class="notepad-card relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-y border-border text-card-foreground shadow-sm sm:rounded-[2rem] sm:border"
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
              <div class="h-full flex-1 min-h-0">
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

                  <div bind:this={primaryEditorRoot} class={`h-full min-h-full ${isDocumentUnderProposal(getPaneDocumentSession(PRIMARY_PANE_ID)) ? 'hidden' : ''}`}></div>
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
              <div class="h-full flex-1 min-h-0">
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

                  <div bind:this={secondaryEditorRoot} class={`h-full min-h-full ${isDocumentUnderProposal(getPaneDocumentSession(SECONDARY_PANE_ID)) ? 'hidden' : ''}`}></div>
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

    <div class="notepad-bottom-bar absolute left-0 right-0 z-30">
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
    --editor-left-padding: 0rem;
    --editor-handle-lane-width: 2.75rem;
    --editor-right-padding: 1rem;
    --editor-readable-width: 100%;
    --editor-top-padding: 4.6rem;
    --editor-bottom-padding: calc(7rem + env(safe-area-inset-bottom, 0px) + var(--keyboard-inset-height, 0px));
    --related-drawer-gap: 1rem;
    --related-drawer-peek-width: 2.75rem;
    --related-bottom-offset: calc(6.1rem + env(safe-area-inset-bottom, 0px) + var(--keyboard-inset-height, 0px));
    overflow: visible;
  }

  @media (min-width: 640px) {
    .notepad-shell {
      /* --editor-left-padding: 0rem; */
      --editor-handle-lane-width: 3rem;
      --editor-right-padding: 1.4rem;
      --editor-readable-width: 40rem;
      --editor-top-padding: 5.3rem;
      --editor-bottom-padding: 100%;
    }
  }

  @media (min-width: 1280px) {
    .notepad-shell {
      /* --editor-left-padding: 1.25rem; */
      --editor-handle-lane-width: 3.1rem;
      --editor-right-padding: 1.8rem;
      --editor-readable-width: 42rem;
    }
  }

  .notepad-editor-shell {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    -webkit-overflow-scrolling: touch;
  }

  .notepad-card {
    transition: width 300ms ease-out;
    will-change: width;
  }

  .notepad-bottom-bar {
    bottom: var(--keyboard-inset-height, 0px);
    transition: bottom 180ms ease;
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
    position: relative;
    height: 100%;
    min-height: 100%;
    width: 100%;
    max-width: 100%;
    overflow-x: clip;
  }

  .notepad-editor-shell :global(.gn-editor-root .notepad-block-handle [data-role='add']) {
    display: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly) {
    color: var(--foreground);
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-content) {
    max-width: 100%;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h1) {
    margin: 0;
    padding-top: 1.15rem;
    padding-bottom: 0.45rem;
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1.3;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h2) {
    margin: 0;
    padding-top: 1.05rem;
    padding-bottom: 0.4rem;
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1.35;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h3),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h4),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h5),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h6) {
    margin: 0;
    padding-top: 0.9rem;
    padding-bottom: 0.35rem;
    font-weight: 700;
    line-height: 1.28;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h3) {
    font-size: 1.125rem;
    line-height: 1.45;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h4) {
    font-size: 1rem;
    line-height: 1.5;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h5) {
    font-size: 0.875rem;
    line-height: 1.55;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-line.cm-draftly-line-h6) {
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-quote-line) {
    margin: 0;
    padding-top: 0.65rem;
    padding-bottom: 0.65rem;
    padding-left: 1rem;
    border-left: 3px solid color-mix(in oklab, var(--border) 82%, var(--foreground) 18%);
    color: color-mix(in oklab, var(--foreground) 78%, var(--muted-foreground) 22%);
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-code-inline) {
    padding: 0.12rem 0.35rem;
    border-radius: 0.4rem;
    background: color-mix(in oklab, var(--muted) 80%, var(--background));
    color: var(--destructive);
    font-family: var(--font-mono);
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-code-block),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-code-container) {
    margin: 0.65rem 0;
    border-radius: 1rem;
    border: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--muted) 76%, var(--background));
    overflow: hidden;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-code-header) {
    border-bottom: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--muted) 64%, var(--background));
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-code-line),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-code-block-line) {
    font-family: var(--font-mono);
    font-size: 0.92rem;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-list-line-ul),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-list-line-ol),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-task-line) {
    margin: 0;
    padding-top: 0.12rem;
    padding-bottom: 0.12rem;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-list-line-ul),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-list-line-ol) {
    display: block !important;
    align-items: initial !important;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-list-indent) {
    display: none !important;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-list-line-ul .cm-draftly-list-mark-ul),
  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-list-line-ol .cm-draftly-list-mark-ol) {
    display: inline-block;
    width: 1rem;
    vertical-align: top;
    position: relative;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-list-content) {
    display: inline;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-task-checkbox) {
    border-color: var(--gn-task-checkbox-border);
    background: var(--gn-task-checkbox-bg);
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .cm-draftly-task-checkbox.checked) {
    border-color: var(--gn-task-checkbox-checked-border);
    background: var(--gn-task-checkbox-checked-bg);
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .gn-current-search-highlight) {
    border-radius: 0.28rem;
    background: color-mix(in oklab, var(--accent) 76%, var(--foreground) 24%);
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--foreground) 18%, transparent),
      0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent);
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .gn-wikilink) {
    border-radius: 0.35rem;
    background: color-mix(in oklab, var(--accent) 54%, transparent);
    color: color-mix(in oklab, var(--foreground) 88%, var(--accent-foreground) 12%);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-thickness: 0.08em;
    text-underline-offset: 0.14em;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .gn-image-upload-placeholder) {
    display: inline-flex;
    align-items: center;
    padding: 0.45rem 0.7rem;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--card) 92%, var(--background));
    color: color-mix(in oklab, var(--foreground) 72%, transparent);
    font-size: 0.92rem;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .gn-image-embed) {
    display: inline-flex;
    position: relative;
    margin: 0.5rem 0;
    border-radius: 1rem;
    overflow: hidden;
    background: color-mix(in oklab, var(--muted) 74%, var(--background));
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .gn-image-embed img) {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .notepad-editor-shell :global(.gn-editor-root .cm-editor.cm-draftly .gn-image-embed-resize-handle) {
    position: absolute;
    right: 0.35rem;
    bottom: 0.35rem;
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--foreground) 72%, transparent);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--background) 84%, transparent);
    cursor: nwse-resize;
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
