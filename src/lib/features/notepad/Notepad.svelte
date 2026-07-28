<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import type { createProposalOrchestration } from "$lib/features/proposals/proposalOrchestration";
  import { appSettings } from "$lib/appSettings.svelte";
  import { createEditorCapabilityAdapter } from "$lib/features/notepad/editor/editorCapabilities";
  import {
    createNotepadFeatureHost,
    type NotepadFeatureHost,
  } from "$lib/features/notepad/host";
  import { shouldSuppressAutosaveForDocument } from "$lib/features/proposals/reviewHold.svelte";
  import type { ActiveWikilink } from "$lib/features/notepad/wikilinks/wikilinks";
  import { focusInputAtEnd } from "$lib/features/notepad/navigation/navigation";
  import { registerPendingNoteSaveHandler } from "$lib/features/notepad/navigation/pendingNoteSave";
  import {
    navigateToPendingTaskTarget,
    openRecentTask,
    openSearchResult,
    type NavigationContext,
    type OpenContext,
  } from "$lib/features/notepad/navigation/openFlow";
  import { type SearchMode } from "$lib/features/notepad/search/search";
  import {
    markNoteOpened,
    saveNoteSession,
    type ForgottenNote,
    type SessionSnapshot,
  } from "$lib/features/notepad/session/session";
  import { type WikilinkAutocompleteState } from "$lib/features/notepad/wikilinks/state";
  import type { RelatedNoteItem, SearchItem } from "$lib/types/semantic";
  import type { RecentTaskItem } from "$lib/features/notepad/model/types";
  import NotepadCommandBar from "$lib/features/notepad/ui/NotepadCommandBar.svelte";
  import NotepadPane from "$lib/features/notepad/NotepadPane.svelte";
  import type { PaneWorkspaceActions } from "$lib/features/notepad/notepadPane.types";
  import SlashMenu from "$lib/features/notepad/editor/SlashMenu.svelte";
  import SelectionMenu from "$lib/features/notepad/editor/SelectionMenu.svelte";
  import WikilinkAutocomplete from "$lib/features/notepad/wikilinks/WikilinkAutocomplete.svelte";
  import RelatedPanelHost from "$lib/features/notepad/related/RelatedPanelHost.svelte";
  import {
    getCardStyle,
    getRelatedGroupStyle,
  } from "$lib/features/notepad/related/layout";
  import { createNotepadRefreshController } from "$lib/features/notepad/orchestration/notepadRefreshController";
  import { createNotepadSessionLifecycle } from "$lib/features/notepad/orchestration/notepadSessionLifecycle";
  import { createNotepadProposalAdapter } from "$lib/features/notepad/orchestration/notepadProposalAdapter";
  import { NotepadChatCoordinator } from "$lib/features/notepad/orchestration/notepadChatCoordinator.svelte";
  import { createNotepadChatPaneAdapter } from "$lib/features/notepad/orchestration/notepadChatPaneAdapter";
  import {
    createPaneSessionController,
    getSplitSourceNote,
    paneCommandNoteLabel,
  } from "$lib/features/notepad/orchestration/paneSessionController";
  import { createNotepadPersistenceController } from "$lib/features/notepad/orchestration/persistenceController";
  import {
    createNotepadCommands,
    type LocationHistoryEntry,
  } from "$lib/features/notepad/orchestration/notepadCommands";
  import {
    createNotepadWorkspaceCommands,
    type NotepadDerivedViewCommands,
    type NotepadPaneCommands,
  } from "$lib/features/notepad/orchestration/notepadCommandFacades";
  import { createRelatedNotesStore } from "$lib/features/notepad/related/store.svelte";
  import { createNotepadSearchStore } from "$lib/features/notepad/search/store.svelte";
  import { attachPaneSelectionTracking } from "$lib/features/notepad/editor/paneSelectionTracking";
  import type { PaneCommandChoice } from "$lib/features/notepad/paneCommandPicker";
  import {
    createPaneControllers as createPaneControllersFn,
    type PaneControllerSetupDeps,
  } from "$lib/features/notepad/pane/paneControllers";
  import {
    adoptSnapshotForPane,
    getPaneNote,
    getPaneState,
    noteKeyFromPath,
    rekeyNote,
    replaceReferencedNoteWithFreshDraft,
    setActivePane as setStoreActivePane,
    setPaneChatConversationId,
    setPaneKind as setStoredPaneKind,
    setPaneNoteKey as setStoredPaneNoteKey,
    type NoteDraftState,
    type NoteKey,
  } from "$lib/features/notepad/state/noteStore";
  import {
    createNotepadPaneId,
    notepadState,
    notepadRuntimeState,
    updateSharedEditorResourceConfig,
    type NotepadPaneId,
  } from "$lib/features/notepad/session/runtimeStore.svelte";
  import {
    cleanupNoteRuntime,
    transferNoteRuntime,
  } from "$lib/features/notepad/session/noteRuntime";
  import { createDocumentPaneCoordinator } from "$lib/features/notepad/document/documentPaneCoordinator";
  import { createDocumentEditingService } from "$lib/features/notepad/document/documentEditingService";
  import { workspaceStore } from "$lib/features/notepad/workspace/workspaceStore.svelte";
  import { createWorkspacePersistenceService } from "$lib/features/notepad/workspace/workspacePersistenceService";
  import {
    createWorkspaceShortcutHandler,
    registerWorkspaceWindowCloseHandler,
  } from "$lib/features/notepad/workspace/shortcuts";
  import { PaneRuntime } from "$lib/features/notepad/pane/paneRuntime.svelte";
  import { PaneTransientUiController } from "$lib/features/notepad/pane/paneTransientUiController.svelte";
  import { createPaneViewModelFactory } from "$lib/features/notepad/pane/paneViewModelFactory";
  import { createPaneEditorLifecycle } from "$lib/features/notepad/pane/paneEditorLifecycle";
  import { formatNoteTitle } from "$lib/features/notepad/model/document";
  import {
    formatShortcutBinding,
    keyboardShortcuts,
  } from "$lib/keyboardShortcuts.svelte";
  import "$lib/features/notepad/editor/editor.css";
  import "$lib/features/notepad/editor/editorTypography.css";
  import "$lib/features/notepad/markdown/inlineFormatting.css";

  type PaneId = NotepadPaneId;
  const MAX_VISIBLE_PANES = 2;

  const paneTitleInputClass =
    "w-full bg-transparent text-center text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/55 sm:text-2xl";

  let workspaceShell = $state<HTMLDivElement | null>(null);

  // workspaceStore owns pane order, active pane, and pane command chrome.
  let paneOrder = $derived(workspaceStore.paneOrder);
  let activePaneId = $derived(workspaceStore.activePaneId);

  // Pane runtimes own pane-local state (refs, editor controller, readiness, slash menu, wikilink)
  const initialPaneId = notepadRuntimeState.activePaneId;
  const initialPaneIds = Array.from(
    new Set<PaneId>([...workspaceStore.paneOrder, initialPaneId]),
  );
  const paneRuntimes = $state<Record<PaneId, PaneRuntime>>(
    Object.fromEntries(
      initialPaneIds.map((paneId) => [paneId, new PaneRuntime(paneId)]),
    ) as Record<PaneId, PaneRuntime>,
  );
  const paneControllers = {} as Record<
    PaneId,
    ReturnType<typeof createPaneControllersFn<PaneId>>
  >;
  const editorCapabilities = new Map<
    PaneId,
    ReturnType<typeof createEditorCapabilityAdapter>
  >();
  let featureHost: NotepadFeatureHost;
  /** Assigned after `commands` is created; used by early chat open helpers. */
  let touchPaneLocationForHistory: (paneId: PaneId) => void = () => {};

  let currentSearchHighlightMode: SearchMode = "all";
  let currentSearchHighlightQuery = "";

  const searchState = createNotepadSearchStore({
    getCurrentTitle: () => getDocumentSession().title,
    getCurrentMarkdown,
    getCurrentPath: () => getDocumentSession().currentNotePath,
    openSearchResult: handleSearchResultSelect,
    openRecentTask: handleRecentTaskSelect,
    openNote: async (noteId, notePath) =>
      commands.openNotePath(notePath, { noteId }),
    onSearchHighlightsChange: ({
      searchMode,
      searchQuery,
      matchCase,
      matchWholeWord,
    }) => {
      currentSearchHighlightMode = searchMode;
      currentSearchHighlightQuery = searchQuery;
      syncCurrentFileSearchHighlights(searchQuery, searchMode, {
        matchCase,
        matchWholeWord,
      });
    },
  });

  const relatedState = createRelatedNotesStore({
    getCurrentTitle: () => featureHost.getActiveDocumentSnapshot().title,
    getCurrentMarkdown: () =>
      featureHost.getActiveDocumentSnapshot().bodyMarkdown,
    getCurrentPath: () =>
      featureHost.getActiveDocumentSnapshot().currentNotePath,
  });

  let paneCommandPaneId = $derived(workspaceStore.paneCommand.paneId);
  let paneCommandSourceNoteKey = $derived(
    workspaceStore.paneCommand.sourceNoteKey,
  );
  let paneCommandMode = $derived(workspaceStore.paneCommand.mode);
  let paneCommandHighlightedIndex = $derived(
    workspaceStore.paneCommand.highlightedIndex,
  );
  let paneCommandFocusEl = $state<HTMLElement | null>(null);
  $effect(() => {
    workspaceStore.setPaneCommandFocusEl(paneCommandFocusEl);
  });

  let locationHistoryEpoch = $state(0);
  let locationHistoryItems = $state<LocationHistoryEntry[]>([]);

  // ---------------------------------------------------------------------------
  // State accessor helpers (kept as thin getters; the document/pane/command
  // controllers below own all of the policy.)
  // ---------------------------------------------------------------------------

  function ensurePaneRuntime(paneId: PaneId) {
    paneRuntimes[paneId] ??= new PaneRuntime(paneId);
    return paneRuntimes[paneId];
  }

  function getPaneRuntime(paneId: PaneId) {
    const runtime = paneRuntimes[paneId];
    if (!runtime) {
      throw new Error(
        `Pane runtime ${paneId} was accessed before initialization.`,
      );
    }
    return runtime;
  }

  let proposalOrchestrationInstance: ReturnType<
    typeof createProposalOrchestration
  > | null = null;
  function getProposalOrchestration() {
    if (!proposalOrchestrationInstance) {
      throw new Error("Proposal orchestration is not ready yet.");
    }
    return proposalOrchestrationInstance;
  }

  const chatCoordinator = new NotepadChatCoordinator<PaneId>(initialPaneIds, {
    maxVisiblePanes: MAX_VISIBLE_PANES,
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    getEditorPaneIds: () => getEditorPaneIds(),
    getPaneConversationId: (paneId) =>
      getPaneState(notepadState, paneId).chatConversationId,
    setPaneConversationId: (paneId, conversationId) =>
      setPaneChatConversationId(notepadState, paneId, conversationId),
    setStoredPaneKind: (paneId, kind) =>
      setStoredPaneKind(notepadState, paneId, kind),
    setActivePane: workspaceStore.setActivePaneId,
    touchPaneLocation: (paneId) => touchPaneLocationForHistory(paneId),
    splitWorkspace: () => commands.splitWorkspace(),
    resolvePaneCommandChoice: (paneId, choice) =>
      commands.resolvePaneCommandChoice(paneId, choice),
    setPaneKind: (paneId, kind) => commands.setPaneKind(paneId, kind),
    focusPane: (paneId) => commands.focusPaneAfterShortcut(paneId),
    insertMarkdown: (request) => featureHost.insertMarkdown(request),
    getProposalOrchestration,
    clearRecentlyForgottenNote: () => setRecentlyForgotten(null),
    forgottenNoteRetentionPreference: () =>
      appSettings.forgottenNoteRetentionPreference,
    startNewNote: () => commands.startNewNoteFlow(),
    forgetNote: () => commands.clearNotepad(),
    unforgetNote: () => commands.unforgetNotepad(),
  });
  let isActivePaneChat = $derived(getPaneKind(activePaneId) === "chat");
  let canUnforget = $derived(
    isActivePaneChat
      ? chatCoordinator.canUnforget(activePaneId)
      : notepadState.recentlyForgotten !== null,
  );
  let canForgetActiveItem = $derived(
    !isActivePaneChat || chatCoordinator.canForget(activePaneId),
  );

  function ensurePaneControllers(paneId: PaneId) {
    if (!paneControllers[paneId]) {
      paneControllers[paneId] = createPaneControllersFn(
        paneId,
        paneControllerSetupDeps,
      );
    }
    if (!editorCapabilities.has(paneId)) {
      editorCapabilities.set(
        paneId,
        createEditorCapabilityAdapter(() => getPaneRuntime(paneId).controller),
      );
    }
    return paneControllers[paneId];
  }

  function getPaneControllers(paneId: PaneId) {
    return ensurePaneControllers(paneId);
  }

  const transientUi = new PaneTransientUiController<PaneId>({
    getActivePaneId: () => activePaneId,
    getVisiblePaneIds: () => getVisiblePaneIds(),
    getPaneRuntime,
    getEditorCapabilities: (paneId) => editorCapabilities.get(paneId) ?? null,
    getWikilinkController: (paneId) =>
      getPaneControllers(paneId).wikilinkController,
  });
  let activeSlashMenuPaneId = $derived(transientUi.activeSlashMenuPaneId);
  let activeSelectionMenuPaneId = $derived(
    transientUi.activeSelectionMenuPaneId,
  );
  let activeWikilinkPaneId = $derived(transientUi.activeWikilinkPaneId);

  function createPaneRuntime(): PaneId {
    const paneId = createNotepadPaneId();
    ensurePaneRuntime(paneId);
    chatCoordinator.ensureController(paneId);
    ensurePaneControllers(paneId);
    return paneId;
  }

  function getPaneKind(paneId: PaneId) {
    return getPaneState(notepadState, paneId).kind;
  }

  function getPaneEditorRoot(paneId: PaneId) {
    return getPaneRuntime(paneId).refs.editorRoot;
  }

  function focusPaneEditor(paneId: PaneId) {
    return editorCapabilities.get(paneId)?.focus() ?? false;
  }

  function focusPaneEditorAtEnd(paneId: PaneId) {
    return editorCapabilities.get(paneId)?.focusAtEnd() ?? false;
  }

  function focusPaneChat(paneId: PaneId) {
    return chatCoordinator.focusComposer(paneId);
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

  const paneSessionController = createPaneSessionController<PaneId>({
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneKind,
    getPaneDocumentSession,
    activatePaneSession,
    setPaneDocumentSession,
  });

  const {
    getEditorPaneIds,
    getNavigationPaneId,
    getNextPaneId,
    getPaneIdsForDocument,
    getVisiblePaneIds,
  } = paneSessionController;

  function focusTitleAtEnd(paneId: PaneId = getNavigationPaneId()) {
    focusInputAtEnd(getPaneTitleInput(paneId));
  }

  function getNavigationContext(
    paneId: PaneId = getNavigationPaneId(),
  ): NavigationContext {
    const paneDocument = getPaneDocumentSession(paneId);
    return {
      editorRoot: getPaneEditorRoot(paneId),
      titleShell: getPaneRuntime(paneId).refs.titleShell,
      currentNoteId: paneDocument.currentNoteId,
      currentNotePath: paneDocument.currentNotePath,
      focusTitleAtEnd: () => focusTitleAtEnd(paneId),
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
        commands.openNotePath(notePath, { noteId, ...options }),
    };
  }

  // ---------------------------------------------------------------------------
  // Editor markdown change handler — used by the per-pane lifecycle controller.
  // ---------------------------------------------------------------------------
  function handleEditorMarkdownChange(
    paneId: string,
    document: NoteDraftState,
    nextMarkdown: string,
  ) {
    const resolvedPaneId = paneId as PaneId;
    documentEditing.recordUserEdit(resolvedPaneId, document, nextMarkdown);
  }

  // ---------------------------------------------------------------------------
  // Per-pane controllers (editor + wikilink) — built once, reused everywhere.
  // ---------------------------------------------------------------------------
  const paneControllerSetupDeps: PaneControllerSetupDeps<PaneId> = {
    getPaneRuntime,
    getPaneDocument: getPaneDocumentSession,
    activatePaneSession,
    cancelPendingAutosave: (note) => cancelPendingAutosave(note),
    closeEditorTransientUi: (paneId) => {
      closeSlashMenu(paneId);
      closeSelectionMenu(paneId);
      closeWikilinkAutocomplete(paneId);
    },
    handleEditorMarkdownChange,
    getNavigationContext,
    openNotePath: (notePath, options) =>
      commands.openNotePath(notePath, options),
    openWikilink,
    handleActiveWikilinkChange,
    setWikilinkAutocomplete: updatePaneWikilinkState,
  };

  async function rekeyNoteWithRuntime(
    note: NoteDraftState,
    snapshot: SessionSnapshot,
  ) {
    const nextKey = noteKeyFromPath(snapshot.currentNotePath);
    if (!nextKey || nextKey === note.key) {
      return note;
    }

    const previousKey = note.key;
    const nextNote = rekeyNote(notepadState, previousKey, nextKey) ?? note;
    if (nextNote !== note) {
      // A pane already owns the saved path. Rebind every affected pane to
      // that canonical runtime before discarding the draft-key resources.
      await documents.replaceNoteAcrossPanes(note, nextNote, {
        cleanupPrevious: false,
      });
    }
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
    markNoteOpened,
    rekeyNoteWithRuntime,
    applySavedSnapshot: async (
      document,
      snapshot,
      { preserveDraft }
    ) => {
      await documentEditing.applySnapshot(
        document,
        snapshot,
        () =>
          documents.replaceNoteAcrossPanes(
            document,
            document
          ),
        {
          preserveDraft,
          scheduleDerived: false
        }
      );
    },
    isTitleEditing: isTitleInputFocusedForNote,
    isActiveNote: (note) => getDocumentSession() === note,
    shouldSuppressPersistence: (note) =>
      shouldSuppressAutosaveForDocument(note),
  });

  const {
    cancelPendingAutosave,
    enqueueSave,
    flushPendingAutosave,
    getNoteSaveQueue,
    hasCleanBuffer,
    invalidatePendingSaveResults,
    scheduleAutosave,
  } = persistence;

  const documentEditing = createDocumentEditingService<PaneId>({
    isApplyingExternalContent: (document) =>
      getPaneIdsForDocument(document).some(
        (paneId) => getPaneRuntime(paneId).ui.isApplyingExternalContent,
      ),
    shouldSuppressAutosave: shouldSuppressAutosaveForDocument,
    resetPaneCommandAfterBodyInput: (paneId, nextMarkdown) => {
      if (
        paneCommandPaneId === paneId &&
        paneCommandMode !== null &&
        nextMarkdown.trim() !== ""
      ) {
        workspaceStore.resetPaneCommand();
      }
    },
    clearRecentlyForgotten: () => setRecentlyForgotten(null),
    scheduleAutosave,
    scheduleSearch: searchState.scheduleSearch,
    scheduleRelated: relatedState.scheduleRelated,
  });

  ensurePaneControllers(initialPaneId);

  // ---------------------------------------------------------------------------
  // Pane editor sessions serialize mount, swap, replacement and destruction.
  // ---------------------------------------------------------------------------
  function paneShouldMountEditor(paneId: PaneId): boolean {
    return (
      notepadRuntimeState.hasLoadedInitialSession &&
      paneOrder.includes(paneId) &&
      !!notepadState.panesById[paneId] &&
      getPaneKind(paneId) === "editor"
    );
  }

  /** Install an unresolved note review into every currently mounted pane. */
  function presentProposalReview(document: NoteDraftState) {
    for (const paneId of getPaneIdsForDocument(document)) {
      const editor = editorCapabilities.get(paneId);
      if (editor) proposalOrchestrationInstance?.attachEditor(document, editor);
    }
  }

  const paneLifecycle = createPaneEditorLifecycle<PaneId>({
    getPaneIds: () => getVisiblePaneIds(),
    getPaneRuntime,
    getEditorLifecycleController: (paneId) =>
      getPaneControllers(paneId).editorLifecycleController,
    getPaneDocument: getPaneDocumentSession,
    paneShouldMountEditor,
    onEditorMounted: (_paneId, document) => {
      presentProposalReview(document);
    },
    closeWikilinkAutocomplete: (paneId) => closeWikilinkAutocomplete(paneId),
  });

  // ---------------------------------------------------------------------------
  // Cross-pane document binding and cursor coordination.
  // ---------------------------------------------------------------------------
  const documents = createDocumentPaneCoordinator<PaneId>({
    paneLifecycle,
    getPaneRuntime,
    getVisiblePaneIds,
    getPaneIdsForDocument,
    getPaneKind,
    getNavigationDocument: getDocumentSession,
    getNavigationPaneId,
    getPaneDocument: getPaneDocumentSession,
    getNoteByKey,
  });

  const workspacePersistence = createWorkspacePersistenceService({
    flushAllPaneCursorSaves: () => documents.flushAllPendingCursorSaves(),
    getDocuments: () => Object.values(notepadState.notesByKey),
    cancelPendingAutosave,
    enqueueSave,
  });

  // ---------------------------------------------------------------------------
  // Search / related store accessors.
  // ---------------------------------------------------------------------------
  const {
    clearSearch,
    scheduleSearch,
    loadRecentNotes,
    loadRecentTasks,
    openRecentTaskByIndex,
    handleSearchInput,
    handleSearchModeChange,
    handleSearchOpen,
  } = searchState;

  const {
    updateDrawerLayout: updateRelatedDrawerLayoutController,
    clearSelectedRelatedText: clearSelectedRelatedTextController,
    scheduleRelated,
    handleRelatedScopeChange,
    toggleRelatedPanel: toggleRelatedPanelController,
    collapseRelatedPanel: collapseRelatedPanelController,
    updateSelectedRelatedText: updateSelectedRelatedTextController,
  } = relatedState;

  function syncCurrentFileSearchHighlights(
    query: string = currentSearchHighlightQuery,
    mode: SearchMode = currentSearchHighlightMode,
    options = {
      matchCase: searchState.matchCase,
      matchWholeWord: searchState.matchWholeWord,
    },
  ) {
    for (const paneId of getEditorPaneIds()) {
      editorCapabilities.get(paneId)?.setSearchHighlight(null);
    }

    const trimmedQuery = query.trim();
    if (
      mode !== "current" ||
      trimmedQuery === "" ||
      trimmedQuery.startsWith("/")
    ) {
      return;
    }

    for (const paneId of getPaneIdsForDocument(getDocumentSession())) {
      editorCapabilities.get(paneId)?.setSearchHighlight({
        query: trimmedQuery,
        ...options,
      });
    }
  }

  $effect(() => {
    getDocumentSession().key;
    untrack(() => {
      syncCurrentFileSearchHighlights();
    });
  });

  function updatePaneWikilinkState(
    paneId: PaneId,
    nextState: WikilinkAutocompleteState,
  ) {
    transientUi.updateWikilinkState(paneId, nextState);
  }

  function closeSelectionMenu(paneId: PaneId | null = null) {
    transientUi.closeSelectionMenu(paneId);
  }

  function closeSlashMenu(paneId: PaneId | null = null) {
    transientUi.closeSlashMenu(paneId);
  }

  function closeTransientUiExcept(paneId: PaneId) {
    transientUi.closeExcept(paneId);
  }

  function closeWikilinkAutocomplete(paneId: PaneId | null = null) {
    transientUi.closeWikilinkAutocomplete(paneId);
  }

  function handleActiveWikilinkChange(
    paneId: PaneId,
    nextActiveWikilink: ActiveWikilink | null,
  ) {
    transientUi.handleActiveWikilinkChange(paneId, nextActiveWikilink);
  }

  function handleWikilinkKeydown(event: KeyboardEvent) {
    if (paneCommandPaneId !== null) {
      return false;
    }
    return getPaneControllers(
      getNavigationPaneId(),
    ).wikilinkController.handleAutocompleteKeydown(event);
  }

  async function openWikilink(paneId: PaneId, rawTarget: string) {
    workspaceStore.setActivePaneId(paneId);
    if (rawTarget.replaceAll("\\", "/").startsWith("Chats/")) {
      const path = rawTarget.split("#", 1)[0];
      if (
        await chatCoordinator.openProjection(
          paneId,
          path.endsWith(".md") ? path : `${path}.md`,
        )
      )
        return;
    }
    await getPaneControllers(paneId).wikilinkController.openWikilink(rawTarget);
  }

  function handleWikilinkSuggestionSelect(paneId: PaneId, value: string) {
    const state = getPaneRuntime(paneId).ui.wikilinkAutocomplete;
    const nextIndex = state.suggestions.findIndex(
      (suggestion) => suggestion.value === value,
    );
    if (nextIndex === -1) return;

    updatePaneWikilinkState(paneId, { ...state, selectedIndex: nextIndex });
    getPaneControllers(paneId).wikilinkController.selectWikilinkSuggestion(
      value,
    );
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
    if (getPaneKind(paneId) !== "editor") {
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
    proposalOrchestrationInstance?.suspendDocument(
      document,
      editorCapabilities.get(paneId) ?? null,
    );
    documents.flushPaneCursorSave(paneId);
    flushPendingAutosave(document);
    await getNoteSaveQueue(document.key);
    closeWikilinkAutocomplete(paneId);
    closeSlashMenu(paneId);
    closeSelectionMenu(paneId);
    await paneLifecycle.disposePane(paneId);
    runtime.dispose();
    delete paneControllers[paneId];
    editorCapabilities.delete(paneId);
    chatCoordinator.disposePane(paneId);
    delete paneRuntimes[paneId];
  }

  // ---------------------------------------------------------------------------
  // High-level commands (open / forget / unforget / remember / split / close /
  // setKind / pane-command / switch-pane). Encapsulated in notepadCommands so
  // the component does not own every flow body.
  // ---------------------------------------------------------------------------
  const notepadWorkspaceCommands = createNotepadWorkspaceCommands<PaneId>(
    workspaceStore,
    {
      getFocusEl: () => paneCommandFocusEl,
    },
  );

  const notepadPaneCommands: NotepadPaneCommands<PaneId> = {
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    getNavigationDocument: getDocumentSession,
    getNavigationPaneId,
    getNextPaneId,
    getPaneRuntime,
    getNoteByKey,
    activatePaneSession,
    setPaneDocumentSession,
    getPaneTitleInput,
    getPaneEditorRoot,
    focusPaneEditor,
    focusPaneEditorAtEnd,
    focusPaneChat,
    createPane: createPaneRuntime,
    closePaneRuntime,
    updateSelectedRelatedText,
    closeWikilinkAutocomplete,
  };

  const notepadDerivedViewCommands: NotepadDerivedViewCommands<PaneId> = {
    clearSearch,
    scheduleSearchIfNeeded: scheduleSearch,
    scheduleRelatedIfNeeded: scheduleRelated,
    clearSelectedRelatedText,
    loadRecentNotes,
    setRecentlyForgotten,
    closeWikilinkAutocomplete,
  };

  const commands = createNotepadCommands<PaneId>({
    state: notepadState,
    maxVisiblePanes: MAX_VISIBLE_PANES,
    workspace: notepadWorkspaceCommands,
    panes: notepadPaneCommands,
    persistence,
    derivedViews: notepadDerivedViewCommands,
    documents,
    documentEditing,
    paneLifecycle,
    refresh: {
      isRefreshingFromDisk: () => notepadState.isRefreshingFromDisk,
      setRefreshingFromDisk: (value) => {
        notepadState.isRefreshingFromDisk = value;
      },
    },
    forgottenNoteRetentionPreference: () =>
      appSettings.forgottenNoteRetentionPreference,
    canLeaveDocument: () => true,
    onDocumentLeaving: (document) => {
      proposalOrchestrationInstance?.suspendDocument(
        document,
        editorCapabilities.get(getNavigationPaneId()) ?? null,
      );
    },
    onDocumentOpened: (document) => {
      proposalOrchestrationInstance?.restoreDocument(document);
    },
    onDocumentPresented: (document) => {
      presentProposalReview(document);
    },
  });
  touchPaneLocationForHistory = commands.touchCurrentLocation;
  commands.setLocationHistoryEpochListener((epoch) => {
    locationHistoryEpoch = epoch;
  });

  let paneCommandCurrentNoteLabel = $derived.by(() => {
    void locationHistoryEpoch;
    if (paneCommandPaneId === null) {
      return paneCommandNoteLabel(
        getSplitSourceNote(notepadState, paneCommandSourceNoteKey),
      );
    }
    return commands.paneCommandCurrentLocationLabel(paneCommandPaneId);
  });
  let paneCommandPreviousNoteLabel = $derived.by(() => {
    void locationHistoryEpoch;
    if (paneCommandPaneId === null) {
      return null;
    }
    return commands.paneCommandPreviousLocationLabel(paneCommandPaneId);
  });
  let paneCommandPreviousNoteShortcutLabel = $derived(
    formatShortcutBinding(keyboardShortcuts.bindings.goToPreviousNote),
  );

  let locationHistoryRequestId = 0;

  async function refreshLocationHistory() {
    const requestId = ++locationHistoryRequestId;
    const paneId = activePaneId;
    // Paint synchronously from the session MRU first so chat cannot flash away
    // while a seed await is in flight.
    locationHistoryItems = commands.peekLocationHistory(paneId);
    const items = await commands.listLocationHistory(paneId);
    if (requestId !== locationHistoryRequestId || paneId !== activePaneId) {
      return;
    }
    locationHistoryItems = items;
  }

  $effect(() => {
    void locationHistoryEpoch;
    void activePaneId;
    void refreshLocationHistory();
  });

  featureHost = createNotepadFeatureHost({
    getActiveDocument: getDocumentSession,
    getActiveEditor: () =>
      editorCapabilities.get(getNavigationPaneId()) ?? null,
    focusActiveEditor: async (options = {}) => {
      if (options.preferTitle) {
        focusTitleAtEnd();
        return;
      }
      commands.focusPaneAfterShortcut(getNavigationPaneId());
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
      await documentEditing.replaceMarkdown(document, markdown, () =>
        documents.replaceEditorContentInPlace(markdown),
      );
    },
  });

  const proposalAdapter = createNotepadProposalAdapter<PaneId>({
    maxVisiblePanes: MAX_VISIBLE_PANES,
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    setPaneDocument: setPaneDocumentSession,
    getPaneIdsForDocument,
    getEditor: (paneId) => editorCapabilities.get(paneId) ?? null,
    canSplitWorkspace: canUseSplitWorkspace,
    splitWorkspace: splitWorkspaceIfAllowed,
    createSplitPane: commands.splitWorkspace,
    getPendingPaneCommandId: () => workspaceStore.paneCommand.paneId,
    resolvePaneCommandChoice: commands.resolvePaneCommandChoice,
    setPaneKind: commands.setPaneKind,
    setActivePane: workspaceStore.setActivePaneId,
    activatePane: commands.activatePane,
    openNote: commands.openNotePath,
    paneLifecycle,
    cancelPendingAutosave,
    enqueueSave,
    getSaveQueue: (document) => getNoteSaveQueue(document.key),
    scheduleAutosave,
    refreshCurrentNote: commands.refreshCurrentNoteIfChanged,
  });
  const {
    orchestration: proposalOrchestration,
    getNearestEditorPaneId,
  } = proposalAdapter;
  proposalOrchestrationInstance = proposalOrchestration;

  const chatPaneAdapter = createNotepadChatPaneAdapter<PaneId>({
    coordinator: chatCoordinator,
    proposal: proposalOrchestration,
    getPaneOrder: () => paneOrder,
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    getPaneConversationId: (paneId) =>
      getPaneState(notepadState, paneId).chatConversationId,
    setPaneConversationId: (paneId, conversationId) =>
      setPaneChatConversationId(notepadState, paneId, conversationId),
    touchPaneLocation: (paneId) => touchPaneLocationForHistory(paneId),
    getSelectedRelatedText: () => relatedState.selectedText,
    getEditorPaneIds,
    setActivePane: workspaceStore.setActivePaneId,
    openNote: commands.openNotePath,
    flushPendingAutosave,
    getNoteSaveQueue: (document) => getNoteSaveQueue(document.key),
  });

  // ---------------------------------------------------------------------------
  // Refresh controller (window focus / vault changes / visibility).
  // ---------------------------------------------------------------------------
  function refreshDerivedViews() {
    void loadRecentNotes();
    void loadRecentTasks();
    scheduleSearch();
    scheduleRelated({ immediate: true });
  }

  const refreshController = createNotepadRefreshController({
    getDocumentSession: () => getDocumentSession(),
    refreshDerivedViews,
    updateRelatedDrawerLayout,
    refreshCurrentNoteIfChanged: commands.refreshCurrentNoteIfChanged,
    refreshCurrentNoteFromTaskMutation:
      commands.refreshCurrentNoteFromTaskMutation,
    getNoteByKey,
    getPaneIdsForDocument,
    replaceNoteAcrossPanes: documents.replaceNoteAcrossPanes,
    replaceReferencedNoteWithFreshDraft: (noteKey) =>
      replaceReferencedNoteWithFreshDraft(notepadState, noteKey),
    noteKeyFromPath,
    shouldDeferRefresh: (notePath) => {
      if (!proposalOrchestration.isReviewingPath(notePath)) return false;
      proposalOrchestration.markConflict(notePath);
      return true;
    },
  });

  const {
    handleWindowFocus,
    handleWindowResize,
    handleVisibilityChange,
    handleVaultNoteChanged,
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

    documentEditing.updateTitle(paneDocument, formattedTitle);
    if (formattedTitle !== "" || paneDocument.bodyMarkdown.trim() !== "") {
      setRecentlyForgotten(null);
    }
    scheduleAutosave(paneDocument);
    scheduleSearch();
    scheduleRelated();
  }

  function handleTitleBlur(paneId: PaneId, rawTitle: string) {
    commitPaneTitle(paneId, rawTitle);
    flushPendingAutosave();
  }

  function handleTitleKeydown(paneId: PaneId, event: KeyboardEvent) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    const titleInput = event.currentTarget as HTMLInputElement;
    titleInput.blur();
    focusPaneEditorAtEnd(paneId);
  }

  async function handleSearchResultSelect(result: SearchItem) {
    if (result.documentKind && result.documentKind !== "note") {
      if (
        await chatCoordinator.openProjection(
          getNavigationPaneId(),
          result.notePath,
          result.blockAnchor ?? null,
        )
      ) {
        clearSearch();
        return;
      }
    }
    workspaceStore.resetPaneCommand();
    if (searchState.searchMode === "current" && result.currentMatchRange) {
      searchState.clearSearch();
      const paneId = getNavigationPaneId();
      activatePaneSession(paneId);
      await tick();
      editorCapabilities
        .get(paneId)
        ?.focusSearchRange(result.currentMatchRange);
      documents.saveCursorPositionForDocument();
      return;
    }

    await openSearchResult(getOpenContext(), getNavigationContext(), result);
    documents.saveCursorPositionForDocument();
  }

  async function handleSearchResultNavigate(result: SearchItem) {
    if (searchState.searchMode !== "current" || !result.currentMatchRange) {
      return;
    }

    workspaceStore.resetPaneCommand();
    const paneId = getNavigationPaneId();
    activatePaneSession(paneId);
    await tick();
    editorCapabilities.get(paneId)?.focusSearchRange(result.currentMatchRange);
    documents.saveCursorPositionForDocument();
  }

  async function handleRecentTaskSelect(task: RecentTaskItem) {
    workspaceStore.resetPaneCommand();
    await openRecentTask(getOpenContext(), getNavigationContext(), task);
    documents.saveCursorPositionForDocument();
  }

  async function handleRelatedItemSelect(item: RelatedNoteItem) {
    if (item.documentKind && item.documentKind !== "note") {
      if (
        await chatCoordinator.openProjection(
          getNavigationPaneId(),
          item.notePath,
          item.blockAnchor ?? null,
        )
      )
        return;
    }
    workspaceStore.resetPaneCommand();
    await openSearchResult(getOpenContext(), getNavigationContext(), {
      noteId: item.noteId,
      notePath: item.notePath,
      fileName: item.noteTitle,
      sectionLabel: item.sectionLabel,
      excerpt: item.excerpt,
      highlightRanges: [],
      matchText: item.matchText,
      reasonLabels: ["related"],
      lexicalScore: null,
      semanticScore: item.score,
      startLine: item.startLine,
      endLine: item.endLine,
      blockAnchor: item.blockAnchor ?? null,
    });
    documents.saveCursorPositionForDocument();
  }

  function canUseSplitWorkspace() {
    return window.innerWidth >= 640 && window.innerHeight >= 560;
  }

  async function splitWorkspaceIfAllowed(
    choice: PaneCommandChoice | undefined = undefined,
  ) {
    // A phone in landscape can cross the width breakpoint while still having
    // far too little vertical room for a useful two-pane editor.
    if (!canUseSplitWorkspace()) {
      return;
    }

    await commands.splitWorkspace();

    if (choice) {
      const targetPaneId = workspaceStore.paneCommand.paneId;
      // If there is no previous location, preserve the picker so it can explain the
      // unavailable option instead of silently resolving to a blank pane.
      const hasPrevious =
        targetPaneId !== null &&
        (await commands.resolvePreviousLocationForPaneCommand(
          targetPaneId as PaneId,
        )) !== null;
      if (targetPaneId && (choice !== "previous" || hasPrevious)) {
        await commands.resolvePaneCommandChoice(targetPaneId as PaneId, choice);
      }
    }
  }

  async function openPaneChoiceInCurrent(choice: PaneCommandChoice) {
    if (choice === "current") {
      await commands.setPaneKind(activePaneId, "editor");
      return;
    }
    if (choice === "thoughtPartner") {
      await commands.setPaneKind(activePaneId, "chat");
      return;
    }

    if (choice === "previous") {
      await commands.goToPreviousLocation();
    }
  }

  // ---------------------------------------------------------------------------
  // Global keyboard dispatch (delegated to workspace/shortcuts module).
  // ---------------------------------------------------------------------------
  const handleGlobalKeydown = createWorkspaceShortcutHandler<PaneId>({
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneTitleInput,
    openThoughtPartner: () => openPaneChoiceInCurrent("thoughtPartner"),
    openSplitPaneOptions: () => splitWorkspaceIfAllowed(),
    openNewChatInSplit: () => splitWorkspaceIfAllowed("thoughtPartner"),
    openPreviousNoteInSplit: () => splitWorkspaceIfAllowed("previous"),
    closePane: commands.closePane,
    switchActivePane: commands.switchActivePane,
    startNewNoteFlow: () => chatCoordinator.startNewActiveItem(),
    toggleRelatedPanel,
    goToPreviousLocation: commands.goToPreviousLocation,
    focusPaneAfterShortcut: commands.focusPaneAfterShortcut,
    handlePaneCommandGlobalKeydown: commands.handlePaneCommandGlobalKeydown,
    handleWikilinkKeydown,
  });

  // ---------------------------------------------------------------------------
  // Pane view-model + actions wired into NotepadPane.svelte.
  // ---------------------------------------------------------------------------
  const getPaneViewModel = createPaneViewModelFactory({
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    getPaneRuntime,
    getChatBindings: chatPaneAdapter.getBindings,
    isReviewingDocument: proposalOrchestration.isReviewingDocument,
    paneTitleInputClass,
    getActiveSlashMenuPaneId: () => activeSlashMenuPaneId,
    getPaneCommandPaneId: () => paneCommandPaneId,
    getPaneCommandHighlightedIndex: () => paneCommandHighlightedIndex,
    getPaneCommandMode: () => paneCommandMode,
    getPaneCommandCurrentNoteLabel: () => paneCommandCurrentNoteLabel,
    getPaneCommandPreviousNoteLabel: () => paneCommandPreviousNoteLabel,
    getPaneCommandPreviousNoteShortcutLabel: () =>
      paneCommandPreviousNoteShortcutLabel,
    paneShouldMountEditor,
    paneLifecycle,
  });

  const paneActions: PaneWorkspaceActions = {
    onActivate: commands.activatePane,
    onClose: commands.closePane,
    onSplit: splitWorkspaceIfAllowed,
    onOpenPaneChoice: openPaneChoiceInCurrent,
    // Restore the previous location from the pane MRU.
    onSwitchToEditor: (paneId) => commands.goToPreviousLocation(paneId),
    onTitleFocus: handleTitleFocus,
    onTitleInput: handleTitleInput,
    onTitleBlur: handleTitleBlur,
    onTitleKeydown: handleTitleKeydown,
    onPaneCommandHighlightChange: (index: number) => {
      workspaceStore.setPaneCommandHighlight(index);
    },
    onPaneCommandChoose: commands.resolvePaneCommandChoice,
  };

  const sessionLifecycle = createNotepadSessionLifecycle({
    hasLoadedInitialSession: () => notepadRuntimeState.hasLoadedInitialSession,
    markInitialSessionLoaded: () => {
      notepadRuntimeState.hasLoadedInitialSession = true;
    },
    isInitialEditorRootReady: () =>
      Boolean(getPaneRuntime(initialPaneId).refs.editorRoot),
    applySession: (snapshot) => {
      adoptSnapshotForPane(notepadState, initialPaneId, snapshot);
      setStoreActivePane(notepadState, initialPaneId);
    },
    applyAssetRoot: updateSharedEditorResourceConfig,
    registerWindowCloseHandler: () =>
      registerWorkspaceWindowCloseHandler({
        getPaneOrder: () => paneOrder,
        getActivePaneId: () => activePaneId,
        getPaneTitleInput,
        closePane: commands.closePane,
        focusPaneAfterShortcut: commands.focusPaneAfterShortcut,
      }),
    registerPendingSaveHandler: () =>
      registerPendingNoteSaveHandler(
        workspacePersistence.flushAllForNavigation,
      ),
    registerTransientMenuListeners: () =>
      transientUi.registerBridgeListeners((paneKey) =>
        paneKey in paneRuntimes ? (paneKey as PaneId) : null,
      ),
    getWorkspaceShell: () => workspaceShell,
    ensurePaneEditors: paneLifecycle.ensurePaneEditors,
    refreshCurrentNote: commands.refreshCurrentNoteFromTaskMutation,
    updateRelatedLayout: updateRelatedDrawerLayout,
    scheduleRelated,
    openNote: commands.openNotePath,
    navigateToTaskTarget: async (target) => {
      if (target) {
        await navigateToPendingTaskTarget(getNavigationContext(), target);
      }
    },
    openChatProjection: (notePath) =>
      chatCoordinator.openProjection(getNavigationPaneId(), notePath),
    focusNavigationPane: () =>
      commands.focusPaneAfterShortcut(getNavigationPaneId()),
    onVaultNoteChanged: (payload) => {
      void handleVaultNoteChanged(payload);
    },
    dispose: () => {
      documents.saveCursorPositionForDocument();
      void workspacePersistence.flushAllForNavigation();
      chatCoordinator.dispose();
      syncCurrentFileSearchHighlights("", "all");
      searchState.dispose();
      relatedState.dispose();
      void paneLifecycle.disposeAll();
    },
  });
  onMount(sessionLifecycle.mount);

  // Selection tracking per pane (cursor save scheduling + related text update).
  function trackPaneSelection(paneId: PaneId) {
    return attachPaneSelectionTracking({
      paneId,
      isEditorReady: getPaneRuntime(paneId).ui.isEditorReady,
      editorRoot: getPaneRuntime(paneId).refs.editorRoot,
      isActivePaneInEditorMode: () =>
        activePaneId === paneId && getPaneKind(paneId) === "editor",
      persistCursorPosition: () => documents.schedulePaneCursorSave(paneId),
      updateSelectedRelatedText: () => updateSelectedRelatedText(paneId),
      flushPendingCursorSave: () => documents.flushPaneCursorSave(paneId),
    });
  }

  $effect(() => {
    const cleanups = getVisiblePaneIds()
      .map((paneId) => trackPaneSelection(paneId))
      .filter(
        (cleanup): cleanup is () => void => typeof cleanup === "function",
      );

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  });
</script>

<svelte:window
  onkeydowncapture={handleGlobalKeydown}
  onfocus={handleWindowFocus}
  onresize={handleWindowResize}
/>
<svelte:document onvisibilitychange={handleVisibilityChange} />

<div
  bind:this={workspaceShell}
  class="notepad-shell relative h-full w-full min-h-0 overflow-visible"
>
  <div
    class="relative h-full min-h-0 w-full [--related-reserved-width:0px] [--related-balance-width:0px]"
    style={getRelatedGroupStyle(
      relatedState.panelPlacement,
      relatedState.reservedWidth,
    )}
  >
    <div
      class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-y border-border text-card-foreground shadow-sm transition-[margin-left,margin-right,width] duration-300 ease-out will-change-[margin-left,margin-right,width] sm:rounded-4xl sm:border"
      style={getCardStyle(relatedState.panelPlacement)}
    >
      <div
        class="pointer-events-none absolute inset-0 bg-card/55 backdrop-blur-xl"
      ></div>

      {#if paneOrder.length === 2}
        <div
          class={`pointer-events-none absolute top-0 bottom-0 z-20 hidden w-1/2 border-2 border-border rounded-t-4xl sm:block ${
            paneOrder.indexOf(activePaneId) === 0 ? "left-0" : "right-0"
          }`}
        ></div>
      {/if}

      <div class="relative z-10 flex min-h-0 min-w-0 flex-1 gap-0 px-0 pt-0">
        {#each paneOrder as paneId (paneId)}
          <NotepadPane
            pane={getPaneRuntime(paneId)}
            viewModel={getPaneViewModel(paneId)}
            actions={paneActions}
            bind:paneCommandFocusRoot={paneCommandFocusEl}
          />
        {/each}
      </div>

      <div
        class="absolute right-0 left-0 z-30 bottom-(--keyboard-inset-height) transition-[bottom] duration-180 ease-in-out"
      >
        <NotepadCommandBar
          forget={{
            canUnforget,
            canForget: canForgetActiveItem,
            itemLabel: isActivePaneChat ? "chat" : "note",
            onForget: () => void chatCoordinator.forgetActiveItem(),
            onUnforget: () => void chatCoordinator.unforgetActiveItem(),
          }}
          remember={{
            label: isActivePaneChat ? "New Chat" : "New Idea",
            ariaLabel: isActivePaneChat
              ? "New Chat. Start a blank chat in this pane."
              : "New Idea. Start a blank note in this pane.",
            onRemember: () => void chatCoordinator.startNewActiveItem(),
          }}
          search={{
            searchMode: searchState.searchMode,
            searchQuery: searchState.searchQuery,
            matchCase: searchState.matchCase,
            matchWholeWord: searchState.matchWholeWord,
            searchResults: searchState.searchResults,
            recentLocations: locationHistoryItems,
            recentTasks: searchState.recentTasks,
            isSearching: searchState.isSearching,
            onSearchInput: handleSearchInput,
            onSearchModeChange: handleSearchModeChange,
            onMatchCaseChange: searchState.handleMatchCaseChange,
            onMatchWholeWordChange: searchState.handleMatchWholeWordChange,
            onSearchSelect: (result) =>
              void handleSearchResultSelect(result).catch((error) => {
                console.error("Failed to open searched note:", error);
              }),
            onSearchNavigate: (result) =>
              void handleSearchResultNavigate(result).catch((error) => {
                console.error("Failed to navigate search result:", error);
              }),
            onRecentLocationSelect: (entry) =>
              void commands
                .openLocationFromHistory(entry.location)
                .catch((error) => {
                  console.error("Failed to open recent location:", error);
                }),
            onRecentTaskSelect: (task) =>
              void handleRecentTaskSelect(task).catch((error) => {
                console.error("Failed to open recent task:", error);
              }),
            onRecentLocationShortcut: (index) => {
              const entry = locationHistoryItems[index];
              if (entry) {
                void commands
                  .openLocationFromHistory(entry.location)
                  .catch((error) => {
                    console.error("Failed to open recent location:", error);
                  });
              }
            },
            onRecentTaskShortcut: (index) => void openRecentTaskByIndex(index),
            onSearchOpen: () => {
              handleSearchOpen();
              void refreshLocationHistory();
            },
            onCommand: (command) =>
              commands.handleNotepadCommandBarCommand(command),
          }}
        />
      </div>
    </div>

    {#if relatedState.panelPlacement === "side"}
      <RelatedPanelHost
        placement={relatedState.panelPlacement}
        reservedWidth={relatedState.reservedWidth}
        collapsed={relatedState.isPanelCollapsed}
        items={relatedState.items}
        scope={relatedState.scope}
        status={relatedState.status}
        reason={relatedState.reason}
        loading={relatedState.isLoading}
        hasSelection={!!relatedState.selectedText}
        onToggle={toggleRelatedPanel}
        onClose={closeRelatedPanel}
        onScopeChange={handleRelatedScopeChange}
        onSelect={(item) =>
          void handleRelatedItemSelect(item).catch((error) => {
            console.error("Failed to open related note:", error);
          })}
      />
    {/if}
  </div>

  {#if relatedState.panelPlacement !== "side"}
    <RelatedPanelHost
      placement={relatedState.panelPlacement}
      reservedWidth={relatedState.reservedWidth}
      collapsed={relatedState.isPanelCollapsed}
      items={relatedState.items}
      scope={relatedState.scope}
      status={relatedState.status}
      reason={relatedState.reason}
      loading={relatedState.isLoading}
      hasSelection={!!relatedState.selectedText}
      onToggle={toggleRelatedPanel}
      onClose={closeRelatedPanel}
      onScopeChange={handleRelatedScopeChange}
      onSelect={(item) =>
        void handleRelatedItemSelect(item).catch((error) => {
          console.error("Failed to open related note:", error);
        })}
    />
  {/if}

  {#if activeSlashMenuPaneId}
    <SlashMenu
      menu={getPaneRuntime(activeSlashMenuPaneId).ui.slashMenu}
      boundsElement={getPaneRuntime(activeSlashMenuPaneId).refs.paneCard}
    />
  {/if}

  {#if activeSelectionMenuPaneId}
    {@const selectionPaneId = activeSelectionMenuPaneId}
    <SelectionMenu
      menu={getPaneRuntime(activeSelectionMenuPaneId).ui.selectionMenu}
      boundsElement={getPaneRuntime(activeSelectionMenuPaneId).refs.paneCard}
      onThoughtPartner={({ text }) => {
        void chatCoordinator.discussSelection(selectionPaneId, text).catch((error) => {
          console.error("Failed to discuss selection:", error);
        });
      }}
    />
  {/if}

  {#if activeWikilinkPaneId}
    {@const wikilinkPaneId = activeWikilinkPaneId}
    {@const wikilinkState =
      getPaneRuntime(activeWikilinkPaneId).ui.wikilinkAutocomplete}
    <WikilinkAutocomplete
      active={wikilinkState.active}
      activeWikilink={wikilinkState.activeWikilink}
      suggestions={wikilinkState.suggestions}
      selectedIndex={wikilinkState.selectedIndex}
      onSelect={(suggestion) =>
        handleWikilinkSuggestionSelect(wikilinkPaneId, suggestion.value)}
    />
  {/if}
</div>

<style>
  .notepad-shell {
    --editor-left-padding: 0rem;
    --editor-handle-lane-width: 2.75rem;
    --editor-right-padding: 1rem;
    --editor-readable-width: 100%;
    --editor-top-padding: 4.1rem;
    --editor-bottom-padding: calc(
      7rem + env(safe-area-inset-bottom, 0px) +
        var(--keyboard-inset-height, 0px)
    );
    --related-drawer-gap: 0.5rem;
    --related-drawer-peek-width: 1.75rem;
    --related-bottom-offset: calc(
      6.1rem + env(safe-area-inset-bottom, 0px) +
        var(--keyboard-inset-height, 0px)
    );
    --crepe-color-background: var(--card);
    --crepe-color-on-background: var(--foreground);
    --crepe-color-surface: color-mix(
      in oklab,
      var(--card) 92%,
      var(--background)
    );
    --crepe-color-surface-low: color-mix(
      in oklab,
      var(--muted) 74%,
      var(--card)
    );
    --crepe-color-on-surface: var(--card-foreground);
    --crepe-color-on-surface-variant: var(--muted-foreground);
    --crepe-color-outline: color-mix(
      in oklab,
      var(--border) 82%,
      var(--foreground)
    );
    --crepe-color-primary: var(--foreground);
    --crepe-color-secondary: var(--accent);
    --crepe-color-on-secondary: var(--accent-foreground);
    --crepe-color-inverse: var(--foreground);
    --crepe-color-on-inverse: var(--background);
    --crepe-color-inline-code: var(--destructive);
    --crepe-color-error: var(--destructive);
    --crepe-color-hover: color-mix(in oklab, var(--accent) 82%, transparent);
    --crepe-color-selected: color-mix(
      in oklab,
      var(--accent) 92%,
      var(--background)
    );
    --crepe-color-inline-area: color-mix(
      in oklab,
      var(--muted) 80%,
      var(--background)
    );
    --gn-editor-selection-background: color-mix(
      in oklab,
      var(--foreground) 42%,
      var(--background)
    );
    --gn-editor-selection-color: var(--background);
    --gn-task-checkbox-border: color-mix(
      in oklab,
      var(--foreground) 20%,
      var(--card) 80%
    );
    --gn-task-checkbox-bg: color-mix(
      in oklab,
      var(--card) 92%,
      var(--muted) 8%
    );
    --gn-task-checkbox-checked-border: color-mix(
      in oklab,
      var(--foreground) 28%,
      var(--card) 72%
    );
    --gn-task-checkbox-checked-bg: color-mix(
      in oklab,
      var(--foreground) 18%,
      var(--card) 82%
    );
    --gn-task-checkbox-check: color-mix(
      in oklab,
      var(--foreground) 88%,
      white 12%
    );
    --gn-code-keyword: color-mix(
      in oklab,
      var(--accent) 70%,
      var(--foreground) 30%
    );
    --gn-code-name: var(--foreground);
    --gn-code-property: color-mix(
      in oklab,
      var(--accent) 60%,
      var(--foreground) 40%
    );
    --gn-code-variable: var(--foreground);
    --gn-code-function: color-mix(
      in oklab,
      var(--accent) 80%,
      var(--foreground) 20%
    );
    --gn-code-constant: var(--destructive);
    --gn-code-type: color-mix(
      in oklab,
      var(--accent) 50%,
      var(--foreground) 50%
    );
    --gn-code-operator: color-mix(
      in oklab,
      var(--foreground) 60%,
      var(--accent) 40%
    );
    --gn-code-string: color-mix(in oklab, var(--foreground) 55%, green 45%);
    --gn-code-comment: var(--muted-foreground);
    --gn-code-invalid: var(--destructive);
  }

  @media (min-width: 640px) {
    .notepad-shell {
      --editor-handle-lane-width: 3rem;
      --editor-right-padding: 1.4rem;
      --editor-readable-width: 40rem;
      --editor-top-padding: 5.3rem;
      --editor-bottom-padding: 100%;
    }
  }

  @media (min-width: 768px) {
    .notepad-shell {
      --editor-left-padding: 0.75rem;
    }
  }

  @media (min-width: 1280px) {
    .notepad-shell {
      --editor-handle-lane-width: 3.1rem;
      --editor-right-padding: 1.8rem;
      --editor-readable-width: 42rem;
    }
  }

  @media (max-height: 559px) {
    .notepad-shell {
      --editor-top-padding: 4.1rem;
      --editor-bottom-padding: calc(
        7rem + env(safe-area-inset-bottom, 0px) +
          var(--keyboard-inset-height, 0px)
      );
    }
  }
</style>
