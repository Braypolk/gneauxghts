<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { type UnlistenFn } from '@tauri-apps/api/event';
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
  import { loadBootstrapPayload } from '$lib/features/notepad/session/bootstrap';
  import { appStore } from '$lib/app/appStore.svelte';
  import { type WikilinkAutocompleteState } from '$lib/features/notepad/wikilinks/state';
  import {
    getNextSplitChoiceIndex,
    getSplitChoiceByIndex,
    getSplitChoiceForShortcut,
    type SplitChoice
  } from '$lib/features/notepad/splitPanePicker';
  import type { RecentTaskItem } from '$lib/features/notepad/model/types';
  import BottomBar from '$lib/features/notepad/ui/BottomBar.svelte';
  import NotepadPane, {
    type PaneViewModel,
    type PaneWorkspaceActions
  } from '$lib/features/notepad/NotepadPane.svelte';
  import SlashMenu, {
    type PaneSlashMenuModel
  } from '$lib/features/notepad/editor/SlashMenu.svelte';
  import WikilinkAutocomplete from '$lib/features/notepad/wikilinks/WikilinkAutocomplete.svelte';
  import RelatedPanel from '$lib/features/notepad/related/RelatedPanel.svelte';
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
  import { createRelatedNotesStore } from '$lib/features/notepad/related/store';
  import { createNotepadSearchStore } from '$lib/features/notepad/search/store';
  import { findCmContentElement } from '$lib/features/notepad/editor/editorDom';
  import { attachPaneSelectionTracking } from '$lib/features/notepad/editor/paneSelectionTracking';
  import { createEditorLifecycleController } from '$lib/features/notepad/editor/editorLifecycleController';
  import {
    getPaneIdForSlashMenuView,
    setSlashMenuListener
  } from '$lib/features/notepad/editor/slashMenuBridge';
  import type { SlashMenuSnapshot } from '$lib/features/notepad/editor/slashMenu';
  import { createWikilinkRuntime } from '$lib/features/notepad/wikilinks/runtime';
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
    notepadState,
    notepadRuntimeState,
    PRIMARY_PANE_ID,
    SECONDARY_PANE_ID,
    updateSharedEditorResourceConfig,
    type NotepadPaneId
  } from '$lib/features/notepad/session/runtimeStore.svelte';
  import {
    bumpSharedEditorStateGeneration,
    cleanupNoteRuntime,
    getEditorPaneCountForNote,
    getSharedEditorResources,
    getSharedEditorState,
    getSharedEditorStateGeneration,
    registerEditorPaneForNote,
    setSharedEditorState,
    setSharedEditorStateGeneration,
    transferNoteRuntime,
    unregisterEditorPaneForNote
  } from '$lib/features/notepad/session/noteRuntime';
  import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
  import { createDocumentSyncController } from '$lib/features/notepad/document/documentSyncController';
  import { workspaceStore } from '$lib/features/notepad/workspace/workspaceStore.svelte';
  import { createWorkspacePersistenceService } from '$lib/features/notepad/workspace/workspacePersistenceService';
  import { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';
  import '$lib/features/notepad/editor/editor.css';

  type PaneId = NotepadPaneId;
  type PaneKind = 'editor' | 'chat';
  const PENDING_MAP_NOTE_PATH_KEY = 'gneauxghts:pending-map-note-path';

  const paneTitleInputClass =
    'w-full bg-transparent text-center text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/55 sm:text-2xl';

  let workspaceShell = $state<HTMLDivElement | null>(null);
  let semanticStatusUnlisten: UnlistenFn | null = null;

  // workspaceStore owns pane order, active pane, and split picker chrome.
  // We derive read-only locals so the rest of this file keeps reading the
  // existing names.
  let paneOrder = $derived(workspaceStore.paneOrder);
  let activePaneId = $derived(workspaceStore.activePaneId);

  // Pane runtimes own pane-local state (refs, editor controller, readiness, slash menu, wikilink)
  const paneRuntimes: Record<PaneId, PaneRuntime> = {} as Record<PaneId, PaneRuntime>;

  let canUnforget = $derived(notepadState.recentlyForgotten !== null);
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;
  let semanticStatus = $state<SemanticStatus | null>(null);
  let currentSearchHighlightMode: SearchMode = 'all';
  let currentSearchHighlightQuery = '';

  const searchState = createNotepadSearchStore({
    getCurrentTitle: () => getDocumentSession().title,
    getCurrentMarkdown,
    getCurrentPath: () => getDocumentSession().currentNotePath,
    openSearchResult: handleSearchResultSelect,
    openRecentTask: handleRecentTaskSelect,
    openNote: async (noteId, notePath) => openNotePath(notePath, { noteId }),
    onSearchHighlightsChange: ({ searchMode, searchQuery }) => {
      currentSearchHighlightMode = searchMode;
      currentSearchHighlightQuery = searchQuery;
      syncCurrentFileSearchHighlights(searchQuery, searchMode);
    }
  });

  const relatedState = createRelatedNotesStore({
    getCurrentTitle: () => getDocumentSession().title,
    getCurrentMarkdown,
    getCurrentPath: () => getDocumentSession().currentNotePath
  });

  let splitPickerPaneId = $derived(workspaceStore.splitPicker.paneId);
  let splitPickerSourceNoteKey = $derived(workspaceStore.splitPicker.sourceNoteKey);
  let splitPickerHighlightedIndex = $derived(workspaceStore.splitPicker.highlightedIndex);
  // splitPickerFocusEl is bidirectional: bound by NotepadPane via bind:splitPickerFocusRoot,
  // and propagated into workspaceStore via the effect below.
  let splitPickerFocusEl = $state<HTMLElement | null>(null);
  $effect(() => {
    workspaceStore.setSplitPickerFocusEl(splitPickerFocusEl);
  });

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
    return paneRuntimes[paneId].controller;
  }

  function getPaneEditorRoot(paneId: PaneId) {
    return paneRuntimes[paneId].refs.editorRoot;
  }

  function getPaneTitleInput(paneId: PaneId) {
    return paneRuntimes[paneId].refs.titleInput;
  }

  function applySlashMenuSnapshotForPane(
    paneId: PaneId,
    snapshot: SlashMenuSnapshot,
    view: EditorView
  ) {
    if (!snapshot.open) {
      paneRuntimes[paneId].setSlashMenu({ open: false });
      return;
    }
    paneRuntimes[paneId].setSlashMenu({
      open: true,
      view,
      anchorPos: snapshot.anchorPos,
      groups: snapshot.groups,
      hoverIndex: snapshot.hoverIndex
    });
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
      titleShell: paneRuntimes[paneId].refs.titleShell,
      currentNoteId: paneDocument.currentNoteId,
      currentNotePath: paneDocument.currentNotePath,
      focusTitleAtEnd: () => focusTitleAtEnd(paneId)
    };
  }

  function getOpenContext(): OpenContext {
    const currentDoc = getDocumentSession();
    return {
      currentNoteId: currentDoc.currentNoteId,
      currentNotePath: currentDoc.currentNotePath,
      stopPendingAutosave: cancelPendingAutosave,
      clearSearch,
      openNotePath: async (noteId, notePath, options) => openNotePath(notePath, { noteId, ...options })
    };
  }

  function getDocumentSession() {
    return getPaneDocumentSession(getNavigationPaneId());
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
    workspaceStore.setActivePaneId(paneId);
    return getPaneState(notepadState, paneId);
  }

  function setRecentlyForgotten(value: ForgottenNote | null) {
    notepadState.recentlyForgotten = value;
  }

  function getCurrentMarkdown() {
    return getDocumentSession().bodyMarkdown;
  }

  function flushPaneCursorSave(paneId: PaneId) {
    paneRuntimes[paneId].flushCursorSave(() => {
      paneControllers[paneId].editorLifecycleController.saveCursorPositionForDocument(
        getPaneDocumentSession(paneId)
      );
    });
  }

  function schedulePaneCursorSave(paneId: PaneId) {
    paneRuntimes[paneId].scheduleCursorSave(() => {
      paneControllers[paneId].editorLifecycleController.saveCursorPositionForDocument(
        getPaneDocumentSession(paneId)
      );
    });
  }

  function flushAllPendingCursorSaves() {
    flushPaneCursorSave(PRIMARY_PANE_ID);
    flushPaneCursorSave(SECONDARY_PANE_ID);
  }

  function registerPaneEditorForDocument(
    paneId: PaneId,
    document: NoteDraftState = getPaneDocumentSession(paneId)
  ) {
    registerEditorPaneForNote(document.key, paneId);
  }

  function unregisterPaneEditorForDocument(
    paneId: PaneId,
    document: NoteDraftState = getPaneDocumentSession(paneId)
  ) {
    unregisterEditorPaneForNote(document.key, paneId);
  }

  function markPaneDocumentGeneration(
    paneId: PaneId,
    document: NoteDraftState = getPaneDocumentSession(paneId)
  ) {
    paneRuntimes[paneId].ui.editorGeneration = getSharedEditorStateGeneration(document);
  }

  const documentSync = createDocumentSyncController<PaneId>({
    getPaneIdsForDocument,
    getPaneEditorGeneration: (paneId) => paneRuntimes[paneId].ui.editorGeneration,
    setPaneEditorGeneration: (paneId, value) => {
      paneRuntimes[paneId].ui.editorGeneration = value;
    },
    hasController: (paneId) => getPaneController(paneId) !== null,
    applySharedEditorState: (paneId, document) =>
      paneControllers[paneId].editorLifecycleController.applySharedEditorStateForDocument(document),
    listReferencedNoteKeys: () => listReferencedNoteKeys(notepadState),
    getNoteByKey
  });

  const flushDocumentEditorSync = documentSync.flushDocumentEditorSync;
  const scheduleDocumentEditorSync = documentSync.scheduleDocumentEditorSync;
  const flushAllPendingDocumentSyncs = documentSync.flushAllPendingDocumentSyncs;
  const hasPendingDocumentSync = documentSync.hasPendingSync;

  function saveCursorPositionForDocument(document: NoteDraftState = getDocumentSession()) {
    for (const paneId of getPaneIdsForDocument(document)) {
      paneRuntimes[paneId].flushCursorSave(() => {
        paneControllers[paneId].editorLifecycleController.saveCursorPositionForDocument(document);
      });
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
      if (!getSharedEditorState(document) && editorState) {
        setSharedEditorState(document, editorState);
      }
      return;
    }

    if (
      getSharedEditorState(document) &&
      paneRuntimes[paneId].ui.editorGeneration < getSharedEditorStateGeneration(document)
    ) {
      return;
    }

    paneControllers[paneId].editorLifecycleController.saveSharedEditorStateForDocument(
      document,
      editorState
    );
  }

  function discardSharedEditorStateForDocument(document: NoteDraftState) {
    setSharedEditorState(document, null);
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
      setSharedEditorState(document, editorState);
      bumpSharedEditorStateGeneration(document);
      markPaneDocumentGeneration(resolvedPaneId, document);
    }

    if (document.bodyMarkdown !== nextMarkdown) {
      document.bodyMarkdown = nextMarkdown;
      document.operationRevision += 1;
    }
    if (getPaneIdsForDocument(document).some((pid) => paneRuntimes[pid].ui.isApplyingExternalContent)) {
      return;
    }

    if (nextMarkdown.trim() !== '') {
      setRecentlyForgotten(null);
    }

    scheduleAutosave(document);
    scheduleDocumentEditorSync(document);
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded();
  }

  function handleTitleInput(paneId: PaneId, event: Event) {
    activatePaneSession(paneId);
    const paneDocument = getPaneDocumentSession(paneId);

    const nextTitle = (event.currentTarget as HTMLInputElement).value;
    if (paneDocument.title !== nextTitle) {
      paneDocument.title = nextTitle;
      paneDocument.operationRevision += 1;
    }
    if (paneDocument.title.trim() !== '' || paneDocument.bodyMarkdown.trim() !== '') {
      setRecentlyForgotten(null);
    }
    scheduleAutosave(paneDocument);
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded();
  }

  function handleTitleBlur() {
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

    if (keyboardShortcutMatchesEvent(event, 'goToPreviousNote')) {
      event.preventDefault();
      void openRecentNoteByIndex(0);
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
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
  }

  const refreshController = createNotepadRefreshController({
    getDocumentSession: () => getDocumentSession(),
    refreshDerivedViews,
    updateRelatedDrawerLayout,
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

  function scheduleSearchIfNeeded() {
    if ($searchState.searchQuery.trim() !== '') {
      scheduleSearch();
    }
  }

  function scheduleRelatedIfNeeded(options: { immediate?: boolean } = {}) {
    if (!$relatedState.isPanelCollapsed) {
      scheduleRelated(options);
    }
  }

  function syncCurrentFileSearchHighlights(
    query: string = currentSearchHighlightQuery,
    mode: SearchMode = currentSearchHighlightMode
  ) {
    for (const paneId of getEditorPaneIds()) {
      setEditorCurrentSearchHighlightQuery(getPaneController(paneId), null);
    }

    const trimmedQuery = query.trim();
    if (mode !== 'current' || trimmedQuery === '' || trimmedQuery.startsWith('/')) {
      return;
    }

    for (const paneId of getPaneIdsForDocument(getDocumentSession())) {
      setEditorCurrentSearchHighlightQuery(getPaneController(paneId), trimmedQuery);
    }
  }

  $effect(() => {
    getDocumentSession().key;
    untrack(() => {
      syncCurrentFileSearchHighlights();
    });
  });

  function updatePaneWikilinkState(paneId: PaneId, nextState: WikilinkAutocompleteState) {
    paneRuntimes[paneId].setWikilinkAutocomplete(nextState);
  }

  function createPaneRuntimeFn(paneId: PaneId) {
    const editorLifecycleController = createEditorLifecycleController({
      getController: () => getPaneController(paneId),
      getPaneId: () => paneId,
      setController: (value) => {
        paneRuntimes[paneId].setController(value);
      },
      getShellElement: () => paneRuntimes[paneId].refs.paneCard,
      getEditorShell: () => paneRuntimes[paneId].refs.editorShell,
      getEditorRoot: () => getPaneEditorRoot(paneId),
      getDocumentSession: () => getPaneDocumentSession(paneId),
      getSharedEditorState,
      setSharedEditorState,
      setIsEditorReady: (value) => {
        paneRuntimes[paneId].setIsEditorReady(value);
      },
      setIsApplyingExternalContent: (value) => {
        paneRuntimes[paneId].setIsApplyingExternalContent(value);
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
      getState: () => paneRuntimes[paneId].ui.wikilinkAutocomplete,
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
    scheduleAutosave,
    awaitAllSaveQueues
  } = createNotepadPersistenceController({
    getDocumentSession,
    saveNoteSession,
    rekeyNoteWithRuntime
  });

  const workspacePersistence = createWorkspacePersistenceService({
    listReferencedNoteKeys: () => listReferencedNoteKeys(notepadState),
    getNoteByKey,
    flushDocumentEditorSync,
    flushAllPaneCursorSaves: () => flushAllPendingCursorSaves(),
    flushPendingAutosave,
    cancelPendingAutosave,
    enqueueSave
  });

  const paneControllers = {
    [PRIMARY_PANE_ID]: createPaneRuntimeFn(PRIMARY_PANE_ID),
    [SECONDARY_PANE_ID]: createPaneRuntimeFn(SECONDARY_PANE_ID)
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

      if (previousNote.key === nextNote.key) {
        // Same note identity — safe in-place buffer replace (avoids full destroy + create).
        await paneControllers[paneId].editorLifecycleController.replaceEditorContentInPlaceForDocument(
          nextNote.bodyMarkdown,
          nextNote
        );
      } else {
        // Different note — full teardown + recreate to bind the correct FileEditorRuntime.
        unregisterPaneEditorForDocument(paneId, previousNote);
        await paneControllers[paneId].editorLifecycleController.replaceEditorContent(
          nextNote.bodyMarkdown,
          {
            restoreCursor,
            suppressReadyReset: true
          }
        );
        if (getPaneController(paneId)) {
          registerPaneEditorForDocument(paneId, nextNote);
        }
      }
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
      !getPaneIdsForDocument(note).some((paneId) => paneRuntimes[paneId].ui.isEditorReady) ||
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
      scheduleSearchIfNeeded();
      scheduleRelatedIfNeeded({ immediate: true });
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
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
    void loadRecentNotes();
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
        scheduleSearchIfNeeded();
        scheduleRelatedIfNeeded({ immediate: true });
        void loadRecentNotes();
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
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
    void loadRecentNotes();
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

    setRecentlyForgotten(null);
    invalidatePendingSaveResults(note);
    cancelPendingAutosave(note);
    discardSharedEditorStateForDocument(note);
    const freshDraft = replaceReferencedNoteWithFreshDraft(notepadState, note.key);
    await replaceNoteAcrossPanes(note, freshDraft);
    clearSearch();
    clearSelectedRelatedText();
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
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
    const paneId = activePaneId;
    const previousDocument = getPaneDocumentSession(paneId);
    if (!options.noteId && !notePath) {
      return;
    }

    if (hasPendingDocumentSync(previousDocument)) {
      flushDocumentEditorSync(previousDocument);
    }
    flushAllPendingCursorSaves();
    saveCursorPositionForDocument(previousDocument);
    saveSharedEditorStateForDocument(previousDocument);
    if (
      !(options.currentNoteAlreadySaved ?? false) &&
      (previousDocument.currentNoteId !== (options.noteId ?? null) ||
        previousDocument.currentNotePath !== notePath)
    ) {
      cancelPendingAutosave(previousDocument);
      void enqueueSave(previousDocument);
    }

    const requestGeneration = paneRuntimes[paneId].bumpOpenRequestGeneration();
    setNoteStatus(previousDocument, 'opening');

    const session = await openNoteSession(options.noteId ?? null, notePath);
    if (paneRuntimes[paneId].getOpenRequestGeneration() !== requestGeneration) {
      return;
    }

    const nextDocument = adoptSnapshotForPane(notepadState, paneId, session);
    setRecentlyForgotten(null);
    closeWikilinkAutocomplete(paneId);
    clearSelectedRelatedText();

    if (
      paneRuntimes[paneId].ui.isEditorReady &&
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
    scheduleRelatedIfNeeded({ immediate: true });
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
    workspaceStore.setActivePaneId(paneId);
    await paneControllers[paneId].wikilinkController.openWikilink(rawTarget);
  }

  function handleWikilinkSuggestionSelect(paneId: PaneId, value: string) {
    const state = paneRuntimes[paneId].ui.wikilinkAutocomplete;
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

  function paneShouldMountEditor(paneId: PaneId): boolean {
    return (
      notepadRuntimeState.hasLoadedInitialSession &&
      paneOrder.includes(paneId) &&
      getPaneKind(paneId) === 'editor' &&
      splitPickerPaneId !== paneId
    );
  }

  /**
   * Per-pane mount/destroy queue. Serializes lifecycle transitions so that
   * the use:editor action and any explicit ensurePaneEditors() barrier do
   * not race when both attempt to mount/destroy the same pane in the same
   * microtask.
   */
  const paneEditorQueues: Record<PaneId, Promise<void>> = {
    [PRIMARY_PANE_ID]: Promise.resolve(),
    [SECONDARY_PANE_ID]: Promise.resolve()
  };

  function enqueuePaneEditorOp(paneId: PaneId, op: () => Promise<void>): Promise<void> {
    const queue = paneEditorQueues[paneId].then(op).catch((error) => {
      console.error(`Pane editor lifecycle (${paneId}) failed:`, error);
    });
    paneEditorQueues[paneId] = queue;
    return queue;
  }

  /**
   * Mount the editor for a single pane. Idempotent: if already mounted,
   * returns immediately. Serialized per-pane so concurrent callers (the
   * use:editor action and ensurePaneEditors) do not race.
   */
  function mountPaneEditor(paneId: PaneId): Promise<void> {
    return enqueuePaneEditorOp(paneId, async () => {
      if (getPaneController(paneId)) return;
      const editorRoot = getPaneEditorRoot(paneId);
      if (!editorRoot) return;
      const paneDocument = getPaneDocumentSession(paneId);

      await paneControllers[paneId].editorLifecycleController.createEditor(paneDocument.bodyMarkdown);
      if (getPaneController(paneId)) {
        registerPaneEditorForDocument(paneId, paneDocument);
      }
      paneControllers[paneId].editorLifecycleController.restoreCursorPositionForDocument(paneDocument);
      documentSync.markPaneDocumentGeneration(paneId, paneDocument);
    });
  }

  /**
   * Destroy the editor for a single pane. Idempotent: if not mounted,
   * returns immediately. Serialized per-pane.
   */
  function destroyPaneEditor(paneId: PaneId): Promise<void> {
    return enqueuePaneEditorOp(paneId, async () => {
      const controller = getPaneController(paneId);
      if (!controller) return;
      const paneDocument = getPaneDocumentSession(paneId);

      unregisterPaneEditorForDocument(paneId, paneDocument);
      paneControllers[paneId].editorLifecycleController.saveCursorPositionForDocument(paneDocument);
      if (paneRuntimes[paneId].ui.editorGeneration >= getSharedEditorStateGeneration(paneDocument)) {
        saveSharedEditorStateForDocument(paneDocument, readEditorState(controller), paneId);
      }
      await paneControllers[paneId].editorLifecycleController.destroyEditor();
      paneRuntimes[paneId].ui.isEditorReady = false;
      closeWikilinkAutocomplete(paneId);
    });
  }

  /**
   * Reconcile every pane's editor mount state with the workspace. Used as
   * an explicit barrier in async flows that need to wait for editors to be
   * ready (split/close/setKind/onMount). Reactively, the use:editor action
   * also drives the same mount/destroy transitions.
   */
  async function ensurePaneEditors() {
    for (const paneId of [PRIMARY_PANE_ID, SECONDARY_PANE_ID] as const) {
      if (paneShouldMountEditor(paneId)) {
        await mountPaneEditor(paneId);
      } else {
        await destroyPaneEditor(paneId);
      }
    }
  }

  function activatePane(paneId: PaneId) {
    flushDocumentEditorSync(getPaneDocumentSession(paneId));
    activatePaneSession(paneId);
    updateSelectedRelatedText(paneId);
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
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
    workspaceStore.beginSplitPicker(targetPaneId, sharedDocument.key);

    workspaceStore.setPaneOrder([PRIMARY_PANE_ID, SECONDARY_PANE_ID]);
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

    workspaceStore.removePane(paneId);

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

    const cmContent = findCmContentElement(getPaneEditorRoot(paneId));
    if (cmContent instanceof HTMLElement) {
      cmContent.focus({ preventScroll: true });
      return;
    }

    titleInput?.focus();
  }

  function moveSplitPickerHighlight(direction: 1 | -1) {
    workspaceStore.setSplitPickerHighlight(
      getNextSplitChoiceIndex(
        splitPickerHighlightedIndex,
        direction,
        splitPickerPreviousItem !== null
      )
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
    workspaceStore.resetSplitPicker();
  }

  async function finalizeSplitPickerSelection(paneId: PaneId) {
    await tick();
    await ensurePaneEditors();
    updateSelectedRelatedText(paneId);
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
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

  function getPaneViewModel(paneId: PaneId): PaneViewModel {
    const paneKind = getPaneKind(paneId);
    const paneDocument = getPaneDocumentSession(paneId);
    const isPrimaryPane = paneId === PRIMARY_PANE_ID;
    const stackClass = activePaneId === paneId ? 'z-10' : 'z-0';

    return {
      paneId,
      ariaLabel: isPrimaryPane ? 'Primary pane' : 'Secondary pane',
      bodyClass: `relative flex min-h-0 flex-1 flex-col ${stackClass}`,
      frameClass: `relative flex min-h-0 flex-1 overflow-hidden ${stackClass}`,
      paneKind,
      isEditorReady: paneRuntimes[paneId].ui.isEditorReady,
      isSlashMenuOpen: paneRuntimes[paneId].ui.slashMenu.open,
      isSplitPickerOpen: splitPickerPaneId === paneId,
      showCloseButton: paneOrder.length > 1,
      titleClass: paneTitleInputClass,
      titlePlaceholder: paneKind === 'editor' ? 'Title' : 'Chat title',
      titleValue: paneDocument.title,
      titleReadonly: splitPickerPaneId === paneId,
      chatDescription: isPrimaryPane
        ? 'Chat panes are scaffolded for the multipane layout. This pane already tracks focus, title chrome, and close behavior, but the actual chat experience is still a placeholder in this pass.'
        : 'This placeholder reserves the pane contract for a future chat implementation while keeping the workspace architecture aligned around split panes and a shared note session.',
      splitPickerHighlightedIndex,
      splitPickerCurrentNoteLabel,
      splitPickerPreviousNoteLabel,
      editorLifecycle: {
        shouldMount: paneShouldMountEditor(paneId),
        mount: () => mountPaneEditor(paneId),
        destroy: () => destroyPaneEditor(paneId)
      }
    };
  }

  const paneActions: PaneWorkspaceActions = {
    onActivate: activatePane,
    onClose: closePane,
    onSplit: splitWorkspace,
    onTitleInput: handleTitleInput,
    onTitleBlur: handleTitleBlur,
    onTitleKeydown: handleTitleKeydown,
    onSplitHighlightChange: (index: number) => {
      workspaceStore.setSplitPickerHighlight(index);
    },
    onSplitChoose: resolveSplitPickerChoice
  };

  // Initialize pane runtimes after all function declarations to avoid TDZ in runes mode
  paneRuntimes[PRIMARY_PANE_ID] = new PaneRuntime(PRIMARY_PANE_ID);
  paneRuntimes[SECONDARY_PANE_ID] = new PaneRuntime(SECONDARY_PANE_ID);

  onMount(() => {
    let mounted = true;
    const unregisterPendingNoteSaveHandler = registerPendingNoteSaveHandler(
      workspacePersistence.flushAllForNavigation
    );
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
      if (!mounted || !paneRuntimes[PRIMARY_PANE_ID].refs.editorRoot) return;
      if (notepadRuntimeState.hasLoadedInitialSession) {
        await Promise.all([loadAssetRoot(), loadRememberCapabilities()]);
      } else {
        // Single bundled startup call replaces the parallel fan-out of
        // load_note_session + get_vault_info + get_semantic_status. Falls
        // back to the legacy individual invokes if the bundled command is
        // unavailable or errors.
        try {
          const bootstrap = await loadBootstrapPayload();
          adoptSnapshotForPane(notepadState, PRIMARY_PANE_ID, bootstrap.session);
          setStoreActivePane(notepadState, PRIMARY_PANE_ID);
          updateSharedEditorResourceConfig(
            resolveAssetRootPath(bootstrap.vault.currentPath),
            storePastedImageAsset
          );
          semanticStatus = bootstrap.semanticStatus;
        } catch (error) {
          console.error('bootstrap_app failed, falling back to individual invokes:', error);
          await Promise.all([loadSavedNote(), loadAssetRoot(), loadRememberCapabilities()]);
        }
        notepadRuntimeState.hasLoadedInitialSession = true;
      }
      if (!mounted || !paneRuntimes[PRIMARY_PANE_ID].refs.editorRoot) return;
      try {
        await ensurePaneEditors();
        updateRelatedDrawerLayout();
        scheduleRelatedIfNeeded({ immediate: true });
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
        // Break-the-app: subscribe through the unified AppStore so the
        // page no longer opens its own raw `listen('vault-note-changed', ...)` /
        // `listen('semantic-status-changed', ...)` listeners. The AppStore
        // owns one IPC subscription per channel and re-broadcasts to all
        // consumers; this avoids redundant listeners and lets the store
        // mirror semantic status into a single source of truth.
        const appVaultListen = appStore.subscribeVaultNoteChanged((payload) => {
          void handleVaultNoteChanged(payload);
        });
        vaultNoteChangeUnlisten = () => appVaultListen();
        const appSemanticListen = appStore.subscribeSemanticStatusChanged((status) => {
          semanticStatus = status;
        });
        semanticStatusUnlisten = () => appSemanticListen();
        if (appStore.semanticStatus) {
          semanticStatus = appStore.semanticStatus;
        }
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
      syncCurrentFileSearchHighlights('', 'all');
      searchState.dispose();
      relatedState.dispose();
      unregisterPendingNoteSaveHandler();
      vaultNoteChangeUnlisten?.();
      vaultNoteChangeUnlisten = null;
      semanticStatusUnlisten?.();
      semanticStatusUnlisten = null;
      shellResizeObserver?.disconnect();
      unregisterPaneEditorForDocument(PRIMARY_PANE_ID);
      unregisterPaneEditorForDocument(SECONDARY_PANE_ID);
      void paneControllers[PRIMARY_PANE_ID].editorLifecycleController.destroyEditor();
      void paneControllers[SECONDARY_PANE_ID].editorLifecycleController.destroyEditor();
    };
  });

  function trackPaneSelection(paneId: PaneId) {
    return attachPaneSelectionTracking({
      paneId,
      isEditorReady: paneRuntimes[paneId].ui.isEditorReady,
      editorRoot: paneRuntimes[paneId].refs.editorRoot,
      isActivePaneInEditorMode: () => activePaneId === paneId && getPaneKind(paneId) === 'editor',
      persistCursorPosition: () => schedulePaneCursorSave(paneId),
      updateSelectedRelatedText: () => updateSelectedRelatedText(paneId),
      flushPendingCursorSave: () => flushPaneCursorSave(paneId)
    });
  }

  $effect(() => trackPaneSelection(PRIMARY_PANE_ID));
  $effect(() => trackPaneSelection(SECONDARY_PANE_ID));
</script>

<svelte:window onkeydowncapture={handleGlobalKeydown} onfocus={handleWindowFocus} onresize={handleWindowResize} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<div bind:this={workspaceShell} class="notepad-shell relative h-full w-full min-h-0 overflow-visible">
  <div
    class="notepad-card relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-y border-border text-card-foreground shadow-sm sm:rounded-4xl sm:border"
    style={getCardStyle($relatedState.panelPlacement, $relatedState.reservedWidth)}
  >
    <div class="pointer-events-none absolute inset-0 bg-card/55 backdrop-blur-xl"></div>

    {#if paneOrder.length === 2}
      <div
        class={`pointer-events-none absolute top-0 bottom-0 z-20 hidden w-1/2 border-2 border-border rounded-t-4xl sm:block ${
          activePaneId === PRIMARY_PANE_ID
            ? 'left-0'
            : 'right-0'
        }`}
      ></div>
    {/if}

    <div class="relative z-10 flex min-h-0 flex-1 gap-0 px-0 pt-0">
      {#each paneOrder as paneId (paneId)}
        <NotepadPane
          pane={paneRuntimes[paneId]}
          viewModel={getPaneViewModel(paneId)}
          actions={paneActions}
          bind:splitPickerFocusRoot={splitPickerFocusEl}
        />
      {/each}
    </div>

    <div class="notepad-bottom-bar absolute left-0 right-0 z-30">
      <BottomBar
        forget={{
          canUnforget,
          onForget: () => void clearNotepad(),
          onUnforget: () => void unforgetNotepad()
        }}
        remember={{
          rememberActions: $rememberActionOptions,
          defaultRememberActionId: $defaultRememberActionPreference,
          integrateEnabled: canIntegrate(),
          integrateDisabledReason: integrateDisabledReason(),
          onRemember: (action) => void rememberCurrentNote(action)
        }}
        search={{
          searchMode: $searchState.searchMode,
          searchQuery: $searchState.searchQuery,
          searchResults: $searchState.searchResults,
          recentNotes: $searchState.recentNotes,
          recentTasks: $searchState.recentTasks,
          isSearching: $searchState.isSearching,
          focusRequest: $searchState.focusRequest,
          onSearchInput: handleSearchInput,
          onSearchModeChange: handleSearchModeChange,
          onSearchSelect: (result) =>
            void handleSearchResultSelect(result).catch((error) => {
              console.error('Failed to open searched note:', error);
            }),
          onRecentNoteSelect: (result) =>
            void openRecentNoteItem(result).catch((error) => {
              console.error('Failed to open recent note:', error);
            }),
          onRecentTaskSelect: (task) =>
            void handleRecentTaskSelect(task).catch((error) => {
              console.error('Failed to open recent task:', error);
            }),
          onRecentNoteShortcut: (index) => void openRecentNoteByIndex(index),
          onRecentTaskShortcut: (index) => void openRecentTaskByIndex(index),
          onSearchFocus: handleSearchFocus,
          onCommand: (command) => handleBottomBarCommand(command)
        }}
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

  <SlashMenu menu={paneRuntimes[PRIMARY_PANE_ID].ui.slashMenu} boundsElement={paneRuntimes[PRIMARY_PANE_ID].refs.paneCard} />
  <SlashMenu menu={paneRuntimes[SECONDARY_PANE_ID].ui.slashMenu} boundsElement={paneRuntimes[SECONDARY_PANE_ID].refs.paneCard} />

  <WikilinkAutocomplete
    active={paneRuntimes[PRIMARY_PANE_ID].ui.wikilinkAutocomplete.active}
    activeWikilink={paneRuntimes[PRIMARY_PANE_ID].ui.wikilinkAutocomplete.activeWikilink}
    suggestions={paneRuntimes[PRIMARY_PANE_ID].ui.wikilinkAutocomplete.suggestions}
    selectedIndex={paneRuntimes[PRIMARY_PANE_ID].ui.wikilinkAutocomplete.selectedIndex}
    onSelect={(suggestion) => handleWikilinkSuggestionSelect(PRIMARY_PANE_ID, suggestion.value)}
  />
  <WikilinkAutocomplete
    active={paneRuntimes[SECONDARY_PANE_ID].ui.wikilinkAutocomplete.active}
    activeWikilink={paneRuntimes[SECONDARY_PANE_ID].ui.wikilinkAutocomplete.activeWikilink}
    suggestions={paneRuntimes[SECONDARY_PANE_ID].ui.wikilinkAutocomplete.suggestions}
    selectedIndex={paneRuntimes[SECONDARY_PANE_ID].ui.wikilinkAutocomplete.selectedIndex}
    onSelect={(suggestion) => handleWikilinkSuggestionSelect(SECONDARY_PANE_ID, suggestion.value)}
  />
</div>

