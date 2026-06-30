<script lang="ts">
  import { type UnlistenFn } from '@tauri-apps/api/event';
  import { onMount, tick, untrack } from 'svelte';
  import { forgottenNoteRetentionPreference } from '$lib/appSettings';
  import { setEditorCurrentSearchHighlightQuery } from '$lib/features/notepad/editor/editor';
  import { createEditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
  import {
    createNotepadFeatureHost,
    type NotepadFeatureHost
  } from '$lib/features/notepad/host';
  import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
  import { focusEditorAtEnd, focusInputAtEnd } from '$lib/features/notepad/navigation/navigation';
  import { registerPendingNoteSaveHandler } from '$lib/features/notepad/navigation/pendingNoteSave';
  import {
    navigateToPendingTaskTarget,
    openRecentTask,
    openSearchResult,
    type NavigationContext,
    type OpenContext
  } from '$lib/features/notepad/navigation/openFlow';
  import { type SearchMode } from '$lib/features/notepad/search/search';
  import {
    createEmptySessionSnapshot,
    loadCurrentVaultInfo,
    loadSavedNoteSession,
    resolveAssetRootPath,
    saveNoteSession,
    storePastedImageAsset,
    type ForgottenNote,
    type SessionSnapshot
  } from '$lib/features/notepad/session/session';
  import { appStore } from '$lib/app/appStore.svelte';
  import { type WikilinkAutocompleteState } from '$lib/features/notepad/wikilinks/state';
  import type {
    RelatedNoteItem,
    SearchItem
  } from '$lib/types/semantic';
  import type { RecentTaskItem } from '$lib/features/notepad/model/types';
  import BottomBar from '$lib/features/notepad/ui/BottomBar.svelte';
  import NotepadPane from '$lib/features/notepad/NotepadPane.svelte';
  import type {
    PaneViewModel,
    PaneWorkspaceActions
  } from '$lib/features/notepad/notepadPane.types';
  import SlashMenu from '$lib/features/notepad/editor/SlashMenu.svelte';
  import WikilinkAutocomplete from '$lib/features/notepad/wikilinks/WikilinkAutocomplete.svelte';
  import RelatedPanel from '$lib/features/notepad/related/RelatedPanel.svelte';
  import {
    getBottomSheetStyle,
    getCardStyle,
    getRelatedDrawerStyle,
    getRelatedGroupStyle
  } from '$lib/features/notepad/related/layout';
  import {
    createNotepadRefreshController
  } from '$lib/features/notepad/orchestration/notepadRefreshController';
  import {
    createPaneSessionController,
    findSplitPickerPreviousItem,
    getSplitSourceNote,
    splitPickerNoteLabel,
    splitPickerPreviousNoteLabel as buildSplitPickerPreviousNoteLabel
  } from '$lib/features/notepad/orchestration/paneSessionController';
  import { createNotepadPersistenceController } from '$lib/features/notepad/orchestration/persistenceController';
  import { createNotepadCommands } from '$lib/features/notepad/orchestration/notepadCommands';
  import {
    createNotepadWorkspaceCommands,
    type NotepadDerivedViewCommands,
    type NotepadPaneCommands
  } from '$lib/features/notepad/orchestration/notepadCommandFacades';
  import { createRelatedNotesStore } from '$lib/features/notepad/related/store';
  import { createNotepadSearchStore } from '$lib/features/notepad/search/store.svelte';
  import { attachPaneSelectionTracking } from '$lib/features/notepad/editor/paneSelectionTracking';
  import {
    createPaneControllers as createPaneControllersFn,
    type PaneControllerSetupDeps
  } from '$lib/features/notepad/pane/paneControllers';
  import {
    getPaneIdForSlashMenuView,
    setSlashMenuListener
  } from '$lib/features/notepad/editor/slashMenuBridge';
  import type { SlashMenuSnapshot } from '$lib/features/notepad/editor/slashMenu';
  import {
    adoptSnapshotForPane,
    applySnapshotToNote,
    getPaneNote,
    getPaneState,
    listReferencedNoteKeys,
    noteKeyFromPath,
    rekeyNote,
    replaceReferencedNoteWithFreshDraft,
    setActivePane as setStoreActivePane,
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
    setSharedEditorState,
    transferNoteRuntime
  } from '$lib/features/notepad/session/noteRuntime';
  import { createDocumentSyncController } from '$lib/features/notepad/document/documentSyncController';
  import { createDocumentPaneCoordinator } from '$lib/features/notepad/document/documentPaneCoordinator';
  import { workspaceStore } from '$lib/features/notepad/workspace/workspaceStore.svelte';
  import { createWorkspacePersistenceService } from '$lib/features/notepad/workspace/workspacePersistenceService';
  import { createWorkspaceShortcutHandler } from '$lib/features/notepad/workspace/shortcuts';
  import { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
  import { createPaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';
  import { formatNoteTitle } from '$lib/features/notepad/model/document';
  import type { EditorSnapshot } from '$lib/features/notepad/editor/editor';
  import '$lib/features/notepad/editor/editor.css';

  type PaneId = NotepadPaneId;
  const PANE_IDS_ALL = [PRIMARY_PANE_ID, SECONDARY_PANE_ID] as const;

  const paneTitleInputClass =
    'w-full bg-transparent text-center text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/55 sm:text-2xl';

  let workspaceShell = $state<HTMLDivElement | null>(null);
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;

  // workspaceStore owns pane order, active pane, and split picker chrome.
  let paneOrder = $derived(workspaceStore.paneOrder);
  let activePaneId = $derived(workspaceStore.activePaneId);

  // Pane runtimes own pane-local state (refs, editor controller, readiness, slash menu, wikilink)
  const paneRuntimes: Record<PaneId, PaneRuntime> = {
    [PRIMARY_PANE_ID]: new PaneRuntime(PRIMARY_PANE_ID),
    [SECONDARY_PANE_ID]: new PaneRuntime(SECONDARY_PANE_ID)
  };
  const editorCapabilities = {
    [PRIMARY_PANE_ID]: createEditorCapabilityAdapter(() => paneRuntimes[PRIMARY_PANE_ID].controller),
    [SECONDARY_PANE_ID]: createEditorCapabilityAdapter(() => paneRuntimes[SECONDARY_PANE_ID].controller)
  } as const;
  let featureHost: NotepadFeatureHost;

  let canUnforget = $derived(notepadState.recentlyForgotten !== null);
  let currentSearchHighlightMode: SearchMode = 'all';
  let currentSearchHighlightQuery = '';

  const searchState = createNotepadSearchStore({
    getCurrentTitle: () => getDocumentSession().title,
    getCurrentMarkdown,
    getCurrentPath: () => getDocumentSession().currentNotePath,
    openSearchResult: handleSearchResultSelect,
    openRecentTask: handleRecentTaskSelect,
    openNote: async (noteId, notePath) => commands.openNotePath(notePath, { noteId }),
    onSearchHighlightsChange: ({ searchMode, searchQuery }) => {
      currentSearchHighlightMode = searchMode;
      currentSearchHighlightQuery = searchQuery;
      syncCurrentFileSearchHighlights(searchQuery, searchMode);
    }
  });

  const relatedState = createRelatedNotesStore({
    getCurrentTitle: () => featureHost.getActiveDocumentSnapshot().title,
    getCurrentMarkdown: () => featureHost.getActiveDocumentSnapshot().bodyMarkdown,
    getCurrentPath: () => featureHost.getActiveDocumentSnapshot().currentNotePath
  });

  let splitPickerPaneId = $derived(workspaceStore.splitPicker.paneId);
  let splitPickerSourceNoteKey = $derived(workspaceStore.splitPicker.sourceNoteKey);
  let splitPickerMode = $derived(workspaceStore.splitPicker.mode);
  let splitPickerHighlightedIndex = $derived(workspaceStore.splitPicker.highlightedIndex);
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
      searchState.recentNotes,
      getSplitSourceNote(notepadState, splitPickerSourceNoteKey)
    );
  });

  let splitPickerPreviousNoteLabel = $derived(
    buildSplitPickerPreviousNoteLabel(splitPickerPreviousItem)
  );

  // ---------------------------------------------------------------------------
  // State accessor helpers (kept as thin getters; the document/pane/command
  // controllers below own all of the policy.)
  // ---------------------------------------------------------------------------

  function getPaneKind(paneId: PaneId) {
    return getPaneState(notepadState, paneId).kind;
  }

  function getPaneEditorRoot(paneId: PaneId) {
    return paneRuntimes[paneId].refs.editorRoot;
  }

  function getPaneTitleInput(paneId: PaneId) {
    return paneRuntimes[paneId].refs.titleInput;
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

  function applySlashMenuSnapshotForPane(
    paneId: PaneId,
    snapshot: SlashMenuSnapshot,
    view: import('@codemirror/view').EditorView
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
      openNotePath: async (noteId, notePath, options) =>
        commands.openNotePath(notePath, { noteId, ...options })
    };
  }

  // ---------------------------------------------------------------------------
  // Editor markdown change handler — used by the per-pane lifecycle controller.
  // ---------------------------------------------------------------------------
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
      documents.markPaneDocumentGeneration(resolvedPaneId, document);
    }

    if (document.bodyMarkdown !== nextMarkdown) {
      document.bodyMarkdown = nextMarkdown;
      document.operationRevision += 1;
      if (
        splitPickerPaneId === resolvedPaneId &&
        splitPickerMode !== null &&
        nextMarkdown.trim() !== ''
      ) {
        workspaceStore.resetSplitPicker();
      }
    }
    if (
      getPaneIdsForDocument(document).some(
        (pid) => paneRuntimes[pid].ui.isApplyingExternalContent
      )
    ) {
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

  // ---------------------------------------------------------------------------
  // Per-pane controllers (editor + wikilink) — built once, reused everywhere.
  // ---------------------------------------------------------------------------
  const paneControllerSetupDeps: PaneControllerSetupDeps<PaneId> = {
    getPaneRuntime: (paneId) => paneRuntimes[paneId],
    getPaneDocument: getPaneDocumentSession,
    activatePaneSession,
    cancelPendingAutosave: (note) => cancelPendingAutosave(note),
    closeWikilinkAutocomplete: (paneId) => closeWikilinkAutocomplete(paneId),
    handleEditorMarkdownChange,
    getNavigationContext,
    openNotePath: (notePath, options) => commands.openNotePath(notePath, options),
    openWikilink,
    handleActiveWikilinkChange,
    setWikilinkAutocomplete: updatePaneWikilinkState
  };

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

  function isTitleInputFocusedForNote(note: NoteDraftState) {
    for (const paneId of getPaneIdsForDocument(note)) {
      const titleInput = getPaneTitleInput(paneId);
      if (titleInput && document.activeElement === titleInput) {
        return true;
      }
    }
    return false;
  }

  const persistence = createNotepadPersistenceController({
    getDocumentSession,
    saveNoteSession,
    rekeyNoteWithRuntime,
    isTitleEditing: isTitleInputFocusedForNote
  });

  const {
    cancelPendingAutosave,
    enqueueSave,
    flushPendingAutosave,
    getNoteSaveQueue,
    hasCleanBuffer,
    invalidatePendingSaveResults,
    scheduleAutosave
  } = persistence;

  const paneControllers = {
    [PRIMARY_PANE_ID]: createPaneControllersFn(PRIMARY_PANE_ID, paneControllerSetupDeps),
    [SECONDARY_PANE_ID]: createPaneControllersFn(SECONDARY_PANE_ID, paneControllerSetupDeps)
  } as const;

  // ---------------------------------------------------------------------------
  // Cross-pane document fanout (replace, save, register, mark generation).
  // ---------------------------------------------------------------------------
  const documents = createDocumentPaneCoordinator<PaneId>({
    getPaneRuntime: (paneId) => paneRuntimes[paneId],
    getEditorLifecycleController: (paneId) =>
      paneControllers[paneId].editorLifecycleController,
    getVisiblePaneIds,
    getPaneIdsForDocument,
    getPaneKind,
    getNavigationDocument: getDocumentSession,
    getNavigationPaneId,
    getPaneDocument: getPaneDocumentSession,
    getNoteByKey
  });

  // ---------------------------------------------------------------------------
  // Document-sync controller (rAF-batched fanout of editor state).
  // ---------------------------------------------------------------------------
  const documentSync = createDocumentSyncController<PaneId>({
    getPaneIdsForDocument,
    getPaneEditorGeneration: (paneId) => paneRuntimes[paneId].ui.editorGeneration,
    setPaneEditorGeneration: (paneId, value) => {
      paneRuntimes[paneId].ui.editorGeneration = value;
    },
    hasController: (paneId) => paneRuntimes[paneId].controller !== null,
    applySharedEditorState: (paneId, document) =>
      paneControllers[paneId].editorLifecycleController.applySharedEditorStateForDocument(
        document
      ),
    listReferencedNoteKeys: () => listReferencedNoteKeys(notepadState),
    getNoteByKey
  });

  const flushDocumentEditorSync = documentSync.flushDocumentEditorSync;
  const scheduleDocumentEditorSync = documentSync.scheduleDocumentEditorSync;
  const flushAllPendingDocumentSyncs = documentSync.flushAllPendingDocumentSyncs;
  const hasPendingDocumentSync = documentSync.hasPendingSync;

  // ---------------------------------------------------------------------------
  // Pane editor lifecycle (queued mount/destroy + ensurePaneEditors barrier).
  // ---------------------------------------------------------------------------
  function paneShouldMountEditor(paneId: PaneId): boolean {
    return (
      notepadRuntimeState.hasLoadedInitialSession &&
      paneOrder.includes(paneId) &&
      getPaneKind(paneId) === 'editor'
    );
  }

  const paneLifecycle = createPaneEditorLifecycle<PaneId>({
    paneIds: PANE_IDS_ALL,
    getPaneRuntime: (paneId) => paneRuntimes[paneId],
    getEditorLifecycleController: (paneId) =>
      paneControllers[paneId].editorLifecycleController,
    getPaneDocument: getPaneDocumentSession,
    paneShouldMountEditor,
    registerPaneEditorForDocument: documents.registerPaneEditorForDocument,
    unregisterPaneEditorForDocument: documents.unregisterPaneEditorForDocument,
    markPaneDocumentGeneration: documents.markPaneDocumentGeneration,
    saveSharedEditorStateForDocument: documents.saveSharedEditorStateForDocument,
    closeWikilinkAutocomplete: (paneId) => closeWikilinkAutocomplete(paneId)
  });

  const workspacePersistence = createWorkspacePersistenceService({
    listReferencedNoteKeys: () => listReferencedNoteKeys(notepadState),
    getNoteByKey,
    flushDocumentEditorSync,
    flushAllPaneCursorSaves: () => documents.flushAllPendingCursorSaves(),
    flushPendingAutosave,
    cancelPendingAutosave,
    enqueueSave
  });

  // ---------------------------------------------------------------------------
  // Search / related store accessors.
  // ---------------------------------------------------------------------------
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
    collapseRelatedPanel: collapseRelatedPanelController,
    updateSelectedRelatedText: updateSelectedRelatedTextController
  } = relatedState;

  function scheduleSearchIfNeeded() {
    if (searchState.searchQuery.trim() !== '') {
      scheduleSearch();
    }
  }

  function scheduleRelatedIfNeeded(options: { immediate?: boolean } = { immediate: false }) {
    if (!$relatedState.isPanelCollapsed) {
      scheduleRelated(options);
    }
  }

  function syncCurrentFileSearchHighlights(
    query: string = currentSearchHighlightQuery,
    mode: SearchMode = currentSearchHighlightMode
  ) {
    for (const paneId of getEditorPaneIds()) {
      setEditorCurrentSearchHighlightQuery(paneRuntimes[paneId].controller, null);
    }

    const trimmedQuery = query.trim();
    if (mode !== 'current' || trimmedQuery === '' || trimmedQuery.startsWith('/')) {
      return;
    }

    for (const paneId of getPaneIdsForDocument(getDocumentSession())) {
      setEditorCurrentSearchHighlightQuery(paneRuntimes[paneId].controller, trimmedQuery);
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

  function closeWikilinkAutocomplete(paneId: PaneId | null = null) {
    if (paneId) {
      paneControllers[paneId].wikilinkController.closeWikilinkAutocomplete();
      return;
    }
    paneControllers[PRIMARY_PANE_ID].wikilinkController.closeWikilinkAutocomplete();
    paneControllers[SECONDARY_PANE_ID].wikilinkController.closeWikilinkAutocomplete();
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
    if (nextIndex === -1) return;

    updatePaneWikilinkState(paneId, { ...state, selectedIndex: nextIndex });
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

  function closeRelatedPanel() {
    collapseRelatedPanelController(workspaceShell);
  }

  // ---------------------------------------------------------------------------
  // High-level commands (open / forget / unforget / remember / split / close /
  // setKind / split-picker / switch-pane). Encapsulated in notepadCommands so
  // the component does not own every flow body.
  // ---------------------------------------------------------------------------
  const notepadWorkspaceCommands = createNotepadWorkspaceCommands<PaneId>(workspaceStore, {
    getPreviousItem: () => splitPickerPreviousItem,
    getFocusEl: () => splitPickerFocusEl
  });

  const notepadPaneCommands: NotepadPaneCommands<PaneId> = {
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    getNavigationDocument: getDocumentSession,
    getNavigationPaneId,
    getNextPaneId,
    getPaneRuntime: (paneId) => paneRuntimes[paneId],
    getNoteByKey,
    getOpenContext,
    getNavigationContext,
    activatePaneSession,
    setPaneDocumentSession,
    getPaneTitleInput,
    getPaneEditorRoot,
    updateSelectedRelatedText,
    closeWikilinkAutocomplete
  };

  const notepadDerivedViewCommands: NotepadDerivedViewCommands<PaneId> = {
    clearSearch,
    scheduleSearchIfNeeded,
    scheduleRelatedIfNeeded,
    clearSelectedRelatedText,
    loadRecentNotes,
    setRecentlyForgotten,
    closeWikilinkAutocomplete
  };

  const commands = createNotepadCommands<PaneId>({
    state: notepadState,
    primaryPaneId: PRIMARY_PANE_ID,
    paneIdsAll: PANE_IDS_ALL,
    workspace: notepadWorkspaceCommands,
    panes: notepadPaneCommands,
    persistence,
    derivedViews: notepadDerivedViewCommands,
    documentSync,
    documents,
    paneLifecycle,
    refresh: {
      isRefreshingFromDisk: () => notepadState.isRefreshingFromDisk,
      setRefreshingFromDisk: (value) => {
        notepadState.isRefreshingFromDisk = value;
      }
    },
    forgottenNoteRetentionPreference: () => $forgottenNoteRetentionPreference
  });

  featureHost = createNotepadFeatureHost({
    getActiveDocument: getDocumentSession,
    getActiveEditor: () => editorCapabilities[getNavigationPaneId()] ?? null,
    focusActiveEditor: async (options = {}) => {
      if (options.preferTitle) {
        focusTitleAtEnd();
        return;
      }
      await focusEditorAtEnd(getPaneEditorRoot(getNavigationPaneId()));
    },
    saveActiveDocument: async () => {
      await enqueueSave(getDocumentSession());
    },
    refreshActiveDocument: async (options = {}) => {
      if (options.force) {
        await commands.refreshCurrentNoteFromTaskMutation();
      } else {
        await commands.refreshCurrentNoteIfChanged();
      }
    },
    replaceActiveDocumentMarkdown: async (markdown) => {
      const document = getDocumentSession();
      if (document.bodyMarkdown !== markdown) {
        document.bodyMarkdown = markdown;
        document.operationRevision += 1;
      }
      await documents.replaceEditorContentInPlace(markdown);
      scheduleAutosave(document);
      scheduleSearchIfNeeded();
      scheduleRelatedIfNeeded({ immediate: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Refresh controller (window focus / vault changes / visibility).
  // ---------------------------------------------------------------------------
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
    refreshCurrentNoteIfChanged: commands.refreshCurrentNoteIfChanged,
    refreshCurrentNoteFromTaskMutation: commands.refreshCurrentNoteFromTaskMutation,
    getNoteByKey,
    getPaneIdsForDocument,
    replaceNoteAcrossPanes: documents.replaceNoteAcrossPanes,
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

  // ---------------------------------------------------------------------------
  // Title editing / search-result selection / related-item selection.
  // ---------------------------------------------------------------------------
  function handleTitleFocus(paneId: PaneId) {
    activatePaneSession(paneId);
  }

  function handleTitleInput(paneId: PaneId) {
    activatePaneSession(paneId);
    if (splitPickerPaneId === paneId) {
      workspaceStore.resetSplitPicker();
    }
  }

  function commitPaneTitle(paneId: PaneId, rawTitle: string) {
    const paneDocument = getPaneDocumentSession(paneId);
    const formattedTitle = formatNoteTitle(rawTitle);

    if (paneDocument.title !== formattedTitle) {
      paneDocument.title = formattedTitle;
      paneDocument.operationRevision += 1;
    }
    if (formattedTitle !== '' || paneDocument.bodyMarkdown.trim() !== '') {
      setRecentlyForgotten(null);
    }
    scheduleAutosave(paneDocument);
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded();
  }

  function handleTitleBlur(paneId: PaneId, rawTitle: string) {
    commitPaneTitle(paneId, rawTitle);
    flushPendingAutosave();
  }

  function handleTitleKeydown(paneId: PaneId, event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    event.preventDefault();
    const titleInput = event.currentTarget as HTMLInputElement;
    titleInput.blur();
    void focusEditorAtEnd(getPaneEditorRoot(paneId));
  }

  async function handleSearchResultSelect(result: SearchItem) {
    await openSearchResult(getOpenContext(), getNavigationContext(), result);
    documents.saveCursorPositionForDocument();
  }

  async function handleRecentTaskSelect(task: RecentTaskItem) {
    await openRecentTask(getOpenContext(), getNavigationContext(), task);
    documents.saveCursorPositionForDocument();
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
    documents.saveCursorPositionForDocument();
  }

  // ---------------------------------------------------------------------------
  // Global keyboard dispatch (delegated to workspace/shortcuts module).
  // ---------------------------------------------------------------------------
  const handleGlobalKeydown = createWorkspaceShortcutHandler<PaneId>({
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneTitleInput,
    splitWorkspace: commands.splitWorkspace,
    closePane: commands.closePane,
    switchActivePane: commands.switchActivePane,
    startNewNoteFlow: commands.startNewNoteFlow,
    toggleRelatedPanel,
    openRecentNoteByIndex,
    requestSearchFocus,
    focusPaneAfterShortcut: commands.focusPaneAfterShortcut,
    handleSplitPickerGlobalKeydown: commands.handleSplitPickerGlobalKeydown,
    handleWikilinkKeydown
  });

  // ---------------------------------------------------------------------------
  // Pane view-model + actions wired into NotepadPane.svelte.
  // ---------------------------------------------------------------------------
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
      titleReadonly: false,
      chatDescription: isPrimaryPane
        ? 'Chat panes are scaffolded for the multipane layout. This pane already tracks focus, title chrome, and close behavior, but the actual chat experience is still a placeholder in this pass.'
        : 'This placeholder reserves the pane contract for a future chat implementation while keeping the workspace architecture aligned around split panes and a shared note session.',
      splitPickerHighlightedIndex,
      splitPickerMode,
      splitPickerCurrentNoteLabel,
      splitPickerPreviousNoteLabel,
      editorLifecycle: {
        shouldMount: paneShouldMountEditor(paneId),
        mount: () => paneLifecycle.mountPaneEditor(paneId),
        destroy: () => paneLifecycle.destroyPaneEditor(paneId)
      }
    };
  }

  const paneActions: PaneWorkspaceActions = {
    onActivate: commands.activatePane,
    onClose: commands.closePane,
    onSplit: commands.splitWorkspace,
    onTitleFocus: handleTitleFocus,
    onTitleInput: handleTitleInput,
    onTitleBlur: handleTitleBlur,
    onTitleKeydown: handleTitleKeydown,
    onSplitHighlightChange: (index: number) => {
      workspaceStore.setSplitPickerHighlight(index);
    },
    onSplitChoose: commands.resolveSplitPickerChoice
  };

  // ---------------------------------------------------------------------------
  // Bootstrap / asset root / saved-note fallbacks.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Mount / unmount lifecycle.
  // ---------------------------------------------------------------------------
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
        await loadAssetRoot();
      } else {
        try {
          // Reuse the AppStore-owned bootstrap so we make a single
          // `bootstrap_app` round trip per app launch. The +layout.svelte
          // mount kicks this off; here we await the cached promise so the
          // initial note session, asset root, and semantic status are all
          // populated from one backend call.
          const bootstrap = await appStore.bootstrap();
          adoptSnapshotForPane(notepadState, PRIMARY_PANE_ID, bootstrap.session);
          setStoreActivePane(notepadState, PRIMARY_PANE_ID);
          updateSharedEditorResourceConfig(
            resolveAssetRootPath(bootstrap.vault.currentPath),
            storePastedImageAsset
          );
        } catch (error) {
          console.error('appStore.bootstrap failed, falling back to individual invokes:', error);
          await Promise.all([loadSavedNote(), loadAssetRoot()]);
        }
        notepadRuntimeState.hasLoadedInitialSession = true;
      }
      if (!mounted || !paneRuntimes[PRIMARY_PANE_ID].refs.editorRoot) return;
      try {
        await paneLifecycle.ensurePaneEditors();
        await commands.refreshCurrentNoteFromTaskMutation();
        updateRelatedDrawerLayout();
        scheduleRelatedIfNeeded({ immediate: true });
        const pendingTaskTarget = consumePendingTaskTarget();
        if (pendingTaskTarget) {
          await commands.openNotePath(pendingTaskTarget.notePath, {
            noteId: pendingTaskTarget.noteId,
            focusEditorAfterOpen: false
          });
          await navigateToPendingTaskTarget(getNavigationContext(), pendingTaskTarget);
        }
        // Subscribe to vault note + semantic status changes through the
        // unified AppStore so the page no longer opens raw IPC listeners.
        const appVaultListen = appStore.subscribeVaultNoteChanged((payload) => {
          void handleVaultNoteChanged(payload);
        });
        vaultNoteChangeUnlisten = () => appVaultListen();
        // Semantic status is now a $derived(appStore.semanticStatus); no
        // local mirroring is required.
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
      documents.flushAllPendingCursorSaves();
      documents.saveCursorPositionForDocument();
      documents.saveSharedEditorStateForDocument();
      flushPendingAutosave();
      paneControllers[PRIMARY_PANE_ID].editorLifecycleController.dispose();
      paneControllers[SECONDARY_PANE_ID].editorLifecycleController.dispose();
      syncCurrentFileSearchHighlights('', 'all');
      searchState.dispose();
      relatedState.dispose();
      unregisterPendingNoteSaveHandler();
      vaultNoteChangeUnlisten?.();
      vaultNoteChangeUnlisten = null;
      shellResizeObserver?.disconnect();
      documents.unregisterPaneEditorForDocument(PRIMARY_PANE_ID);
      documents.unregisterPaneEditorForDocument(SECONDARY_PANE_ID);
      void paneControllers[PRIMARY_PANE_ID].editorLifecycleController.destroyEditor();
      void paneControllers[SECONDARY_PANE_ID].editorLifecycleController.destroyEditor();
    };
  });

  // Selection tracking per pane (cursor save scheduling + related text update).
  function trackPaneSelection(paneId: PaneId) {
    return attachPaneSelectionTracking({
      paneId,
      isEditorReady: paneRuntimes[paneId].ui.isEditorReady,
      editorRoot: paneRuntimes[paneId].refs.editorRoot,
      isActivePaneInEditorMode: () => activePaneId === paneId && getPaneKind(paneId) === 'editor',
      persistCursorPosition: () => documents.schedulePaneCursorSave(paneId),
      updateSelectedRelatedText: () => updateSelectedRelatedText(paneId),
      flushPendingCursorSave: () => documents.flushPaneCursorSave(paneId)
    });
  }

  $effect(() => trackPaneSelection(PRIMARY_PANE_ID));
  $effect(() => trackPaneSelection(SECONDARY_PANE_ID));
</script>

<svelte:window onkeydowncapture={handleGlobalKeydown} onfocus={handleWindowFocus} onresize={handleWindowResize} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<div bind:this={workspaceShell} class="notepad-shell relative h-full w-full min-h-0 overflow-visible">
  <div
    class="notepad-related-group relative h-full min-h-0 w-full"
    style={getRelatedGroupStyle($relatedState.panelPlacement, $relatedState.reservedWidth)}
  >
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
          onForget: () => void commands.clearNotepad(),
          onUnforget: () => void commands.unforgetNotepad()
        }}
        remember={{
          onRemember: () => void commands.startNewNoteFlow()
        }}
        search={{
          searchMode: searchState.searchMode,
          searchQuery: searchState.searchQuery,
          searchResults: searchState.searchResults,
          recentNotes: searchState.recentNotes,
          recentTasks: searchState.recentTasks,
          isSearching: searchState.isSearching,
          focusRequest: searchState.focusRequest,
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
          onCommand: (command) => commands.handleBottomBarCommand(command)
        }}
      />
    </div>
  </div>

  {#if $relatedState.panelPlacement === 'side'}
    <aside
      class="related-drawer absolute top-0 bottom-0 z-20 flex min-h-0 items-stretch"
      aria-label="Related notes panel"
      style={getRelatedDrawerStyle($relatedState.reservedWidth)}
    >
      <div class="relative h-full min-h-0 w-full">
        <button
          type="button"
          class="related-drawer-handle group absolute -mx-4 top-1/2 right-0 z-10 flex translate-x-1/2 -translate-y-1/2 items-center"
          aria-expanded={!$relatedState.isPanelCollapsed}
          aria-controls="related-drawer-panel"
          aria-label={$relatedState.isPanelCollapsed ? 'Expand related notes' : 'Collapse related notes'}
          onclick={toggleRelatedPanel}
        >
          <span class="related-drawer-handle-pill flex h-28 w-7 items-center justify-center rounded-full border border-border/70 bg-card/92 p-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground shadow-lg backdrop-blur-md">
            <span class="flex h-full w-full items-center justify-center rounded-full transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
              <span class="-rotate-90">RELATED</span>
            </span>
          </span>
        </button>

        <div
          id="related-drawer-panel"
          class={`absolute inset-y-0 left-0 flex w-full min-h-0 pr-4 transition-[opacity,transform] duration-300 ease-out ${
            $relatedState.isPanelCollapsed
              ? 'pointer-events-none -translate-x-3 opacity-0'
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
              onClose={closeRelatedPanel}
              onSelect={(item) =>
                void handleRelatedItemSelect(item).catch((error) => {
                  console.error('Failed to open related note:', error);
                })}
            />
          </div>
        </div>
      </div>
    </aside>
  {/if}
  </div>

  {#if $relatedState.panelPlacement !== 'side'}
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
            onClose={closeRelatedPanel}
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
