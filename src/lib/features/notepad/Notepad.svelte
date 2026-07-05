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
  import RelatedPanelHost from '$lib/features/notepad/related/RelatedPanelHost.svelte';
  import {
    getCardStyle,
    getRelatedGroupStyle
  } from '$lib/features/notepad/related/layout';
  import {
    createNotepadRefreshController
  } from '$lib/features/notepad/orchestration/notepadRefreshController';
  import {
    createPaneSessionController,
    findPaneCommandPreviousItem,
    getSplitSourceNote,
    paneCommandNoteLabel,
    paneCommandPreviousNoteLabel as buildPaneCommandPreviousNoteLabel
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
  import {
    slashMenuHideFromUi,
    type SlashMenuSnapshot
  } from '$lib/features/notepad/editor/slashMenu';
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
    createNotepadPaneId,
    notepadState,
    notepadRuntimeState,
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
  import {
    createWorkspaceShortcutHandler,
    registerWorkspaceWindowCloseHandler
  } from '$lib/features/notepad/workspace/shortcuts';
  import { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
  import { createPaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';
  import { formatNoteTitle } from '$lib/features/notepad/model/document';
  import { formatShortcutBinding, keyboardShortcutBindings } from '$lib/keyboardShortcuts';
  import type { EditorSnapshot } from '$lib/features/notepad/editor/editor';
  import '$lib/features/notepad/editor/editor.css';

  type PaneId = NotepadPaneId;
  const MAX_VISIBLE_PANES = 2;

  const paneTitleInputClass =
    'w-full bg-transparent text-center text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/55 sm:text-2xl';

  let workspaceShell = $state<HTMLDivElement | null>(null);
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;

  // workspaceStore owns pane order, active pane, and pane command chrome.
  let paneOrder = $derived(workspaceStore.paneOrder);
  let activePaneId = $derived(workspaceStore.activePaneId);

  // Pane runtimes own pane-local state (refs, editor controller, readiness, slash menu, wikilink)
  const initialPaneId = notepadRuntimeState.activePaneId;
  const paneRuntimes = $state<Record<PaneId, PaneRuntime>>({
    [initialPaneId]: new PaneRuntime(initialPaneId)
  });
  const paneControllers = {} as Record<PaneId, ReturnType<typeof createPaneControllersFn<PaneId>>>;
  const editorCapabilities = new Map<PaneId, ReturnType<typeof createEditorCapabilityAdapter>>();
  let activeSlashMenuPaneId = $state<PaneId | null>(null);
  let activeWikilinkPaneId = $state<PaneId | null>(null);
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

  let paneCommandPaneId = $derived(workspaceStore.paneCommand.paneId);
  let paneCommandSourceNoteKey = $derived(workspaceStore.paneCommand.sourceNoteKey);
  let paneCommandMode = $derived(workspaceStore.paneCommand.mode);
  let paneCommandHighlightedIndex = $derived(workspaceStore.paneCommand.highlightedIndex);
  let paneCommandFocusEl = $state<HTMLElement | null>(null);
  $effect(() => {
    workspaceStore.setPaneCommandFocusEl(paneCommandFocusEl);
  });

  let paneCommandCurrentNoteLabel = $derived.by(() =>
    paneCommandNoteLabel(getSplitSourceNote(notepadState, paneCommandSourceNoteKey))
  );

  let paneCommandPreviousItem = $derived.by((): SearchItem | null => {
    if (paneCommandPaneId === null || !paneCommandSourceNoteKey) {
      return null;
    }
    return findPaneCommandPreviousItem(
      searchState.recentNotes,
      getSplitSourceNote(notepadState, paneCommandSourceNoteKey)
    );
  });

  let paneCommandPreviousNoteLabel = $derived(
    buildPaneCommandPreviousNoteLabel(paneCommandPreviousItem)
  );
  let paneCommandPreviousNoteShortcutLabel = $derived(
    formatShortcutBinding($keyboardShortcutBindings.goToPreviousNote)
  );

  // ---------------------------------------------------------------------------
  // State accessor helpers (kept as thin getters; the document/pane/command
  // controllers below own all of the policy.)
  // ---------------------------------------------------------------------------

  function ensurePaneRuntime(paneId: PaneId) {
    paneRuntimes[paneId] ??= new PaneRuntime(paneId);
    return paneRuntimes[paneId];
  }

  function getPaneRuntime(paneId: PaneId) {
    return ensurePaneRuntime(paneId);
  }

  function ensurePaneControllers(paneId: PaneId) {
    if (!paneControllers[paneId]) {
      paneControllers[paneId] = createPaneControllersFn(paneId, paneControllerSetupDeps);
    }
    if (!editorCapabilities.has(paneId)) {
      editorCapabilities.set(
        paneId,
        createEditorCapabilityAdapter(() => getPaneRuntime(paneId).controller)
      );
    }
    return paneControllers[paneId];
  }

  function getPaneControllers(paneId: PaneId) {
    return ensurePaneControllers(paneId);
  }

  function createPaneRuntime(): PaneId {
    const paneId = createNotepadPaneId();
    ensurePaneRuntime(paneId);
    ensurePaneControllers(paneId);
    return paneId;
  }

  function getPaneKind(paneId: PaneId) {
    return getPaneState(notepadState, paneId).kind;
  }

  function getPaneEditorRoot(paneId: PaneId) {
    return getPaneRuntime(paneId).refs.editorRoot;
  }

  function getPaneTitleInput(paneId: PaneId) {
    return getPaneRuntime(paneId).refs.titleInput;
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
    closeTransientUiExcept(paneId);
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
      getPaneRuntime(paneId).setSlashMenu({ open: false });
      if (activeSlashMenuPaneId === paneId) {
        activeSlashMenuPaneId = null;
      }
      return;
    }
    if (paneId !== workspaceStore.activePaneId) {
      slashMenuHideFromUi(view);
      getPaneRuntime(paneId).setSlashMenu({ open: false });
      return;
    }
    for (const visiblePaneId of getVisiblePaneIds()) {
      if (visiblePaneId !== paneId) {
        closeSlashMenu(visiblePaneId);
      }
    }
    closeWikilinkAutocomplete();
    activeSlashMenuPaneId = paneId;
    getPaneRuntime(paneId).setSlashMenu({
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
      titleShell: getPaneRuntime(paneId).refs.titleShell,
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
        paneCommandPaneId === resolvedPaneId &&
        paneCommandMode !== null &&
        nextMarkdown.trim() !== ''
      ) {
        workspaceStore.resetPaneCommand();
      }
    }
    if (
      getPaneIdsForDocument(document).some(
        (pid) => getPaneRuntime(pid).ui.isApplyingExternalContent
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
    getPaneRuntime,
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

  ensurePaneControllers(initialPaneId);

  // ---------------------------------------------------------------------------
  // Cross-pane document fanout (replace, save, register, mark generation).
  // ---------------------------------------------------------------------------
  const documents = createDocumentPaneCoordinator<PaneId>({
    getPaneRuntime,
    getEditorLifecycleController: (paneId) =>
      getPaneControllers(paneId).editorLifecycleController,
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
    getPaneEditorGeneration: (paneId) => getPaneRuntime(paneId).ui.editorGeneration,
    setPaneEditorGeneration: (paneId, value) => {
      getPaneRuntime(paneId).ui.editorGeneration = value;
    },
    hasController: (paneId) => getPaneRuntime(paneId).controller !== null,
    applySharedEditorState: (paneId, document) =>
      getPaneControllers(paneId).editorLifecycleController.applySharedEditorStateForDocument(
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
      !!notepadState.panesById[paneId] &&
      getPaneKind(paneId) === 'editor'
    );
  }

  const paneLifecycle = createPaneEditorLifecycle<PaneId>({
    getPaneIds: () => getVisiblePaneIds(),
    getPaneRuntime,
    getEditorLifecycleController: (paneId) =>
      getPaneControllers(paneId).editorLifecycleController,
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
      setEditorCurrentSearchHighlightQuery(getPaneRuntime(paneId).controller, null);
    }

    const trimmedQuery = query.trim();
    if (mode !== 'current' || trimmedQuery === '' || trimmedQuery.startsWith('/')) {
      return;
    }

    for (const paneId of getPaneIdsForDocument(getDocumentSession())) {
      setEditorCurrentSearchHighlightQuery(getPaneRuntime(paneId).controller, trimmedQuery);
    }
  }

  $effect(() => {
    getDocumentSession().key;
    untrack(() => {
      syncCurrentFileSearchHighlights();
    });
  });

  function updatePaneWikilinkState(paneId: PaneId, nextState: WikilinkAutocompleteState) {
    if (nextState.active) {
      closeSlashMenu();
      for (const visiblePaneId of getVisiblePaneIds()) {
        if (visiblePaneId !== paneId) {
          getPaneControllers(visiblePaneId).wikilinkController.closeWikilinkAutocomplete();
        }
      }
    }
    getPaneRuntime(paneId).setWikilinkAutocomplete(nextState);
    activeWikilinkPaneId = nextState.active ? paneId : activeWikilinkPaneId === paneId ? null : activeWikilinkPaneId;
  }

  function closeSlashMenu(paneId: PaneId | null = null) {
    const paneIds = paneId ? [paneId] : getVisiblePaneIds();
    for (const visiblePaneId of paneIds) {
      const controller = getPaneRuntime(visiblePaneId).controller;
      if (controller) {
        slashMenuHideFromUi(controller.view);
      }
      getPaneRuntime(visiblePaneId).setSlashMenu({ open: false });
    }
    if (paneId === null || activeSlashMenuPaneId === paneId) {
      activeSlashMenuPaneId = null;
    }
  }

  function closeTransientUiExcept(paneId: PaneId) {
    for (const visiblePaneId of getVisiblePaneIds()) {
      if (visiblePaneId === paneId) {
        continue;
      }
      closeSlashMenu(visiblePaneId);
      closeWikilinkAutocomplete(visiblePaneId);
    }
  }

  function closeWikilinkAutocomplete(paneId: PaneId | null = null) {
    if (paneId) {
      getPaneControllers(paneId).wikilinkController.closeWikilinkAutocomplete();
      if (activeWikilinkPaneId === paneId) {
        activeWikilinkPaneId = null;
      }
      return;
    }
    for (const visiblePaneId of getVisiblePaneIds()) {
      getPaneControllers(visiblePaneId).wikilinkController.closeWikilinkAutocomplete();
    }
    activeWikilinkPaneId = null;
  }

  function handleActiveWikilinkChange(paneId: PaneId, nextActiveWikilink: ActiveWikilink | null) {
    getPaneControllers(paneId).wikilinkController.handleActiveWikilinkChange(nextActiveWikilink);
  }

  function handleWikilinkKeydown(event: KeyboardEvent) {
    if (paneCommandPaneId !== null) {
      return false;
    }
    return getPaneControllers(getNavigationPaneId()).wikilinkController.handleAutocompleteKeydown(event);
  }

  async function openWikilink(paneId: PaneId, rawTarget: string) {
    workspaceStore.setActivePaneId(paneId);
    await getPaneControllers(paneId).wikilinkController.openWikilink(rawTarget);
  }

  function handleWikilinkSuggestionSelect(paneId: PaneId, value: string) {
    const state = getPaneRuntime(paneId).ui.wikilinkAutocomplete;
    const nextIndex = state.suggestions.findIndex((suggestion) => suggestion.value === value);
    if (nextIndex === -1) return;

    updatePaneWikilinkState(paneId, { ...state, selectedIndex: nextIndex });
    getPaneControllers(paneId).wikilinkController.selectWikilinkSuggestion(value);
  }

  function updateRelatedDrawerLayout() {
    updateRelatedDrawerLayoutController(workspaceShell);
  }

  function clearSelectedRelatedText() {
    clearSelectedRelatedTextController();
  }

  function updateSelectedRelatedText(paneId: PaneId = getNavigationPaneId()) {
    if (paneCommandPaneId === paneId) {
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

  async function closePaneRuntime(paneId: PaneId) {
    const runtime = getPaneRuntime(paneId);
    const document = getPaneDocumentSession(paneId);
    if (hasPendingDocumentSync(document)) {
      flushDocumentEditorSync(document);
    }
    documents.flushPaneCursorSave(paneId);
    documents.saveSharedEditorStateForDocument(document, null, paneId);
    flushPendingAutosave(document);
    await getNoteSaveQueue(document.key);
    closeWikilinkAutocomplete(paneId);
    getPaneRuntime(paneId).setSlashMenu({ open: false });
    if (activeSlashMenuPaneId === paneId) {
      activeSlashMenuPaneId = null;
    }
    documents.unregisterPaneEditorForDocument(paneId, document);
    getPaneControllers(paneId).editorLifecycleController.dispose();
    await paneLifecycle.destroyPaneEditor(paneId);
    runtime.dispose();
    delete paneControllers[paneId];
    editorCapabilities.delete(paneId);
    delete paneRuntimes[paneId];
  }

  // ---------------------------------------------------------------------------
  // High-level commands (open / forget / unforget / remember / split / close /
  // setKind / pane-command / switch-pane). Encapsulated in notepadCommands so
  // the component does not own every flow body.
  // ---------------------------------------------------------------------------
  const notepadWorkspaceCommands = createNotepadWorkspaceCommands<PaneId>(workspaceStore, {
    getPreviousItem: () => paneCommandPreviousItem,
    getFocusEl: () => paneCommandFocusEl
  });

  const notepadPaneCommands: NotepadPaneCommands<PaneId> = {
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    getNavigationDocument: getDocumentSession,
    getNavigationPaneId,
    getNextPaneId,
    getPaneRuntime,
    getNoteByKey,
    getOpenContext,
    getNavigationContext,
    activatePaneSession,
    setPaneDocumentSession,
    getPaneTitleInput,
    getPaneEditorRoot,
    createPane: createPaneRuntime,
    closePaneRuntime,
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
    maxVisiblePanes: MAX_VISIBLE_PANES,
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
    getActiveEditor: () => editorCapabilities.get(getNavigationPaneId()) ?? null,
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
    if (paneCommandPaneId === paneId) {
      workspaceStore.resetPaneCommand();
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
    workspaceStore.resetPaneCommand();
    await openSearchResult(getOpenContext(), getNavigationContext(), result);
    documents.saveCursorPositionForDocument();
  }

  async function handleRecentTaskSelect(task: RecentTaskItem) {
    workspaceStore.resetPaneCommand();
    await openRecentTask(getOpenContext(), getNavigationContext(), task);
    documents.saveCursorPositionForDocument();
  }

  async function handleRelatedItemSelect(item: RelatedNoteItem) {
    workspaceStore.resetPaneCommand();
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

  async function splitWorkspaceIfAllowed() {
    if (window.innerWidth < 640) {
      return;
    }

    await commands.splitWorkspace();
  }

  // ---------------------------------------------------------------------------
  // Global keyboard dispatch (delegated to workspace/shortcuts module).
  // ---------------------------------------------------------------------------
  const handleGlobalKeydown = createWorkspaceShortcutHandler<PaneId>({
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneTitleInput,
    splitWorkspace: splitWorkspaceIfAllowed,
    closePane: commands.closePane,
    switchActivePane: commands.switchActivePane,
    startNewNoteFlow: commands.startNewNoteFlow,
    toggleRelatedPanel,
    openRecentNoteByIndex,
    requestSearchFocus,
    focusPaneAfterShortcut: commands.focusPaneAfterShortcut,
    handlePaneCommandGlobalKeydown: commands.handlePaneCommandGlobalKeydown,
    handleWikilinkKeydown
  });

  // ---------------------------------------------------------------------------
  // Pane view-model + actions wired into NotepadPane.svelte.
  // ---------------------------------------------------------------------------
  function getPaneViewModel(paneId: PaneId): PaneViewModel {
    const paneKind = getPaneKind(paneId);
    const paneDocument = getPaneDocumentSession(paneId);
    const paneIndex = paneOrder.indexOf(paneId);
    const stackClass = activePaneId === paneId ? 'z-10' : 'z-0';

    return {
      paneId,
      ariaLabel: `Pane ${paneIndex + 1}`,
      bodyClass: `relative flex min-h-0 flex-1 flex-col ${stackClass}`,
      frameClass: `relative flex min-h-0 flex-1 overflow-hidden ${stackClass}`,
      paneKind,
      isEditorReady: getPaneRuntime(paneId).ui.isEditorReady,
      isSlashMenuOpen: activeSlashMenuPaneId === paneId,
      isPaneCommandOpen: paneCommandPaneId === paneId,
      showCloseButton: paneOrder.length > 1,
      titleClass: paneTitleInputClass,
      titlePlaceholder: paneKind === 'editor' ? 'Title' : 'Chat title',
      titleValue: paneDocument.title,
      titleReadonly: false,
      chatDescription:
        'This placeholder reserves the pane contract for a future chat implementation while keeping the workspace architecture aligned around split panes and a shared note session.',
      paneCommandHighlightedIndex,
      paneCommandMode,
      paneCommandCurrentNoteLabel,
      paneCommandPreviousNoteLabel,
      paneCommandPreviousNoteShortcutLabel,
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
    onSplit: splitWorkspaceIfAllowed,
    onTitleFocus: handleTitleFocus,
    onTitleInput: handleTitleInput,
    onTitleBlur: handleTitleBlur,
    onTitleKeydown: handleTitleKeydown,
    onPaneCommandHighlightChange: (index: number) => {
      workspaceStore.setPaneCommandHighlight(index);
    },
    onPaneCommandChoose: commands.resolvePaneCommandChoice
  };

  // ---------------------------------------------------------------------------
  // Bootstrap / asset root / saved-note fallbacks.
  // ---------------------------------------------------------------------------
  async function loadSavedNote() {
    try {
      const snapshot = await loadSavedNoteSession();
      adoptSnapshotForPane(notepadState, initialPaneId, snapshot);
      setStoreActivePane(notepadState, initialPaneId);
    } catch (error) {
      console.error('Failed to load saved note:', error);
      applySnapshotToNote(getPaneDocumentSession(initialPaneId), createEmptySessionSnapshot());
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
    const unregisterWindowCloseHandler = registerWorkspaceWindowCloseHandler({
      getPaneOrder: () => paneOrder,
      getActivePaneId: () => activePaneId,
      getPaneTitleInput,
      closePane: commands.closePane,
      focusPaneAfterShortcut: commands.focusPaneAfterShortcut
    });
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
      if (paneKey && paneKey in paneRuntimes) {
        applySlashMenuSnapshotForPane(paneKey as PaneId, snapshot, view);
      }
    });

    (async () => {
      await tick();
      if (!mounted || !getPaneRuntime(initialPaneId).refs.editorRoot) return;
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
          adoptSnapshotForPane(notepadState, initialPaneId, bootstrap.session);
          setStoreActivePane(notepadState, initialPaneId);
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
      if (!mounted || !getPaneRuntime(initialPaneId).refs.editorRoot) return;
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
      unregisterWindowCloseHandler();
      setSlashMenuListener(null);
      mounted = false;
      flushAllPendingDocumentSyncs();
      documents.flushAllPendingCursorSaves();
      documents.saveCursorPositionForDocument();
      documents.saveSharedEditorStateForDocument();
      flushPendingAutosave();
      for (const paneId of getVisiblePaneIds()) {
        getPaneControllers(paneId).editorLifecycleController.dispose();
      }
      syncCurrentFileSearchHighlights('', 'all');
      searchState.dispose();
      relatedState.dispose();
      unregisterPendingNoteSaveHandler();
      vaultNoteChangeUnlisten?.();
      vaultNoteChangeUnlisten = null;
      shellResizeObserver?.disconnect();
      for (const paneId of getVisiblePaneIds()) {
        documents.unregisterPaneEditorForDocument(paneId);
        void getPaneControllers(paneId).editorLifecycleController.destroyEditor();
      }
    };
  });

  // Selection tracking per pane (cursor save scheduling + related text update).
  function trackPaneSelection(paneId: PaneId) {
    return attachPaneSelectionTracking({
      paneId,
      isEditorReady: getPaneRuntime(paneId).ui.isEditorReady,
      editorRoot: getPaneRuntime(paneId).refs.editorRoot,
      isActivePaneInEditorMode: () => activePaneId === paneId && getPaneKind(paneId) === 'editor',
      persistCursorPosition: () => documents.schedulePaneCursorSave(paneId),
      updateSelectedRelatedText: () => updateSelectedRelatedText(paneId),
      flushPendingCursorSave: () => documents.flushPaneCursorSave(paneId)
    });
  }

  $effect(() => {
    const cleanups = getVisiblePaneIds()
      .map((paneId) => trackPaneSelection(paneId))
      .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  });
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
          paneOrder.indexOf(activePaneId) === 0
            ? 'left-0'
            : 'right-0'
        }`}
      ></div>
    {/if}

    <div class="relative z-10 flex min-h-0 flex-1 gap-0 px-0 pt-0">
      {#each paneOrder as paneId (paneId)}
        <NotepadPane
          pane={getPaneRuntime(paneId)}
          viewModel={getPaneViewModel(paneId)}
          actions={paneActions}
          bind:paneCommandFocusRoot={paneCommandFocusEl}
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
    <RelatedPanelHost
      placement={$relatedState.panelPlacement}
      reservedWidth={$relatedState.reservedWidth}
      collapsed={$relatedState.isPanelCollapsed}
      items={$relatedState.items}
      scope={$relatedState.scope}
      status={$relatedState.status}
      reason={$relatedState.reason}
      loading={$relatedState.isLoading}
      hasSelection={!!$relatedState.selectedText}
      onToggle={toggleRelatedPanel}
      onClose={closeRelatedPanel}
      onScopeChange={handleRelatedScopeChange}
      onSelect={(item) =>
        void handleRelatedItemSelect(item).catch((error) => {
          console.error('Failed to open related note:', error);
        })}
    />
  {/if}
  </div>

  {#if $relatedState.panelPlacement !== 'side'}
    <RelatedPanelHost
      placement={$relatedState.panelPlacement}
      reservedWidth={$relatedState.reservedWidth}
      collapsed={$relatedState.isPanelCollapsed}
      items={$relatedState.items}
      scope={$relatedState.scope}
      status={$relatedState.status}
      reason={$relatedState.reason}
      loading={$relatedState.isLoading}
      hasSelection={!!$relatedState.selectedText}
      onToggle={toggleRelatedPanel}
      onClose={closeRelatedPanel}
      onScopeChange={handleRelatedScopeChange}
      onSelect={(item) =>
        void handleRelatedItemSelect(item).catch((error) => {
          console.error('Failed to open related note:', error);
        })}
    />
  {/if}

  {#if activeSlashMenuPaneId}
    <SlashMenu
      menu={getPaneRuntime(activeSlashMenuPaneId).ui.slashMenu}
      boundsElement={getPaneRuntime(activeSlashMenuPaneId).refs.paneCard}
    />
  {/if}

  {#if activeWikilinkPaneId}
    {@const wikilinkPaneId = activeWikilinkPaneId}
    {@const wikilinkState = getPaneRuntime(activeWikilinkPaneId).ui.wikilinkAutocomplete}
    <WikilinkAutocomplete
      active={wikilinkState.active}
      activeWikilink={wikilinkState.activeWikilink}
      suggestions={wikilinkState.suggestions}
      selectedIndex={wikilinkState.selectedIndex}
      onSelect={(suggestion) => handleWikilinkSuggestionSelect(wikilinkPaneId, suggestion.value)}
    />
  {/if}
</div>
