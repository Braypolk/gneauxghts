<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import type { createProposalOrchestration } from "$lib/features/proposals/proposalOrchestration";
  import { appSettings } from "$lib/appSettings.svelte";
  import { createEditorCapabilityAdapter } from "$lib/features/notepad/editor/editorCapabilities";
  import {
    createNotepadFeatureHost,
    type NotepadFeatureHost,
  } from "$lib/features/notepad/host";
  import { shouldSuppressAutosaveForDocument } from "$lib/features/proposals/reviewSession.svelte";
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
    saveTaskNoteSession,
    type ForgottenNote,
    type SessionSnapshot,
  } from "$lib/features/notepad/session/session";
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
  import { createSearchReturnFocus } from "$lib/features/notepad/search/searchReturnFocus";
  import { attachPaneSelectionTracking } from "$lib/features/notepad/editor/paneSelectionTracking";
  import {
    createPaneControllers as createPaneControllersFn,
    type PaneControllerSetupDeps,
  } from "$lib/features/notepad/pane/paneControllers";
  import {
    adoptSnapshotForPane,
    getPaneNote,
    noteKeyFromPath,
    rekeyNote,
    replaceReferencedNoteWithFreshDraft,
    type NoteDraftState,
    type NoteKey,
  } from "$lib/features/notepad/state/noteStore";
  import { notepadState } from "$lib/features/notepad/state/noteState.svelte";
  import {
    createNotepadPaneId,
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
  import { createDocumentConflictController } from "$lib/features/notepad/document/documentConflictController";
  import { createNotepadTaskMutationHandler } from "$lib/features/notepad/orchestration/notepadTaskMutationAdapter";
  import { registerOpenTaskDocumentMutationHandler } from "$lib/features/tasks/taskMutationGateway";
  import { createTitleInteractionController } from "$lib/features/notepad/interaction/titleInteractionController";
  import { createWikilinkInteractionController } from "$lib/features/notepad/interaction/wikilinkInteractionController";
  import { createNavigationSelectionController } from "$lib/features/notepad/interaction/navigationSelectionController";
  import { createWorkspaceChoiceController } from "$lib/features/notepad/interaction/workspaceChoiceController";
  import {
    documentHasUnresolvedConflict,
    getDocumentMarkdown,
    getDocumentNoteId,
    getDocumentPath,
    getDocumentTitle,
  } from "$lib/features/notepad/document/documentState";
  import { workspaceStore } from "$lib/features/notepad/workspace/workspaceStore.svelte";
  import { paneHasCapability } from "$lib/features/notepad/workspace/paneCapabilities";
  import { createWorkspacePersistenceService } from "$lib/features/notepad/workspace/workspacePersistenceService";
  import HistoryMode from "$lib/features/history/HistoryMode.svelte";
  import {
    clearNoteHistory,
    getHistoryModeDiff,
    getHistoryModeDiagnostics,
    getHistoryModePage,
    nameHistoryRevision,
    removeHistoryRevisionName,
  } from "$lib/features/history/historyApi";
  import { HistoryModeSession } from "$lib/features/history/historyModeSession.svelte";
  import type { HistoryWorkspaceSnapshot } from "$lib/features/history/historyModeMachine";
  import {
    createWorkspaceShortcutHandler,
    registerWorkspaceWindowCloseHandler,
  } from "$lib/features/notepad/workspace/shortcuts";
  import { PaneRuntime } from "$lib/features/notepad/pane/paneRuntime.svelte";
  import { PaneTransientUiController } from "$lib/features/notepad/pane/paneTransientUiController.svelte";
  import { createPaneViewModelFactory } from "$lib/features/notepad/pane/paneViewModelFactory";
  import { createPaneEditorLifecycle } from "$lib/features/notepad/pane/paneEditorLifecycle";
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
  let collapsingPaneId = $derived(workspaceStore.collapsingPaneId);

  // Pane runtimes own pane-local state (refs, editor controller, readiness, slash menu, wikilink)
  const initialPaneId = workspaceStore.activePaneId;
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
    getCurrentTitle: () => getDocumentTitle(getDocumentSession()),
    getCurrentMarkdown,
    getCurrentPath: () => getDocumentPath(getDocumentSession()),
    openSearchResult: (result) =>
      handleSearchResultSelect(result),
    openRecentTask: (task) =>
      handleRecentTaskSelect(task),
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
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    getEditorPaneIds: () => getEditorPaneIds(),
    getPaneConversationId: (paneId) =>
      workspaceStore.getPaneState(paneId).chatConversationId,
    setPaneConversationId: (paneId, conversationId) =>
      workspaceStore.setPaneConversationId(paneId, conversationId),
    setStoredPaneKind: (paneId, kind) =>
      workspaceStore.setPaneKind(paneId, kind),
    setActivePane: workspaceStore.setActivePaneId,
    touchPaneLocation: (paneId) => touchPaneLocationForHistory(paneId),
    splitWorkspace: () => commands.splitWorkspace(),
    resolvePaneCommandChoice: (paneId, choice) =>
      commands.resolvePaneCommandChoice(paneId, choice),
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
  let isActivePaneChat = $derived(
    paneHasCapability(getPaneKind(activePaneId), "host-chat"),
  );
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
  let activeTransientUi = $derived(transientUi.active);

  function createPaneRuntime(): PaneId {
    const paneId = createNotepadPaneId();
    try {
      ensurePaneRuntime(paneId);
      chatCoordinator.ensureController(paneId);
      ensurePaneControllers(paneId);
      return paneId;
    } catch (error) {
      paneRuntimes[paneId]?.dispose();
      delete paneControllers[paneId];
      editorCapabilities.delete(paneId);
      chatCoordinator.disposePane(paneId);
      delete paneRuntimes[paneId];
      throw error;
    }
  }

  function getPaneKind(paneId: PaneId) {
    return workspaceStore.getPaneState(paneId).kind;
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
    return getPaneNote(notepadState, workspaceStore, paneId);
  }

  function setPaneDocumentSession(paneId: PaneId, document: NoteDraftState) {
    workspaceStore.setPaneNoteKey(paneId, document.key);
    return document;
  }

  function activatePaneSession(paneId: PaneId) {
    workspaceStore.setActivePaneId(paneId);
    closeTransientUiExcept(paneId);
    return workspaceStore.getPaneState(paneId);
  }

  function setRecentlyForgotten(value: ForgottenNote | null) {
    notepadState.recentlyForgotten = value;
  }

  function getCurrentMarkdown() {
    return getDocumentMarkdown(getDocumentSession());
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

  const {
    updatePaneWikilinkState,
    closeSelectionMenu,
    closeSlashMenu,
    closeTransientUiExcept,
    closeWikilinkAutocomplete,
    handleActiveWikilinkChange,
    handleWikilinkKeydown,
    openWikilink,
    handleWikilinkSuggestionSelect,
  } = createWikilinkInteractionController<PaneId>({
      transientUi,
      getPaneCommandPaneId: () => paneCommandPaneId,
      getNavigationPaneId,
      getWikilinkController: (paneId) =>
        getPaneControllers(paneId).wikilinkController,
      setActivePane: workspaceStore.setActivePaneId,
      openChatProjection: (paneId, path) =>
        chatCoordinator.openProjection(paneId, path),
      getWikilinkState: (paneId) =>
        getPaneRuntime(paneId).ui.wikilinkAutocomplete,
    });

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
      currentNoteId: getDocumentNoteId(paneDocument),
      currentNotePath: getDocumentPath(paneDocument),
      focusTitleAtEnd: () => focusTitleAtEnd(paneId),
    };
  }

  function getOpenContext(): OpenContext {
    const currentDoc = getDocumentSession();
    return {
      currentNoteId: getDocumentNoteId(currentDoc),
      currentNotePath: getDocumentPath(currentDoc),
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
    persistEditorViewState: (paneId) => {
      const runtime = getPaneRuntime(paneId);
      if (
        runtime.ui.isEditorReady &&
        !runtime.ui.isApplyingProgrammaticUpdate &&
        paneHasCapability(getPaneKind(paneId), "edit-document")
      ) {
        documents.schedulePaneCursorSave(paneId);
      }
    },
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
    const nextNote =
      rekeyNote(
        notepadState,
        workspaceStore,
        previousKey,
        nextKey,
      ) ?? note;
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
    saveTaskNoteSession,
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
    attributeTaskActionSave,
    enqueueSave,
    flushPendingAutosave,
    getNoteSaveQueue,
    hasCleanBuffer,
    invalidatePendingSaveResults,
    scheduleAutosave,
  } = persistence;

  const documentEditing = createDocumentEditingService<PaneId>({
    isApplyingProgrammaticUpdate: (document) =>
      getPaneIdsForDocument(document).some(
        (paneId) => getPaneRuntime(paneId).ui.isApplyingProgrammaticUpdate,
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
      workspaceStore.hasPane(paneId) &&
      paneHasCapability(getPaneKind(paneId), "edit-document")
    );
  }

  /** Install an unresolved note review into every currently mounted pane. */
  function presentProposalReview(document: NoteDraftState) {
    for (const paneId of getPaneIdsForDocument(document)) {
      const editor = editorCapabilities.get(paneId);
      if (editor) proposalOrchestrationInstance?.attachEditor(document, editor);
    }
    void chatCoordinator.showPendingProposalsForDocument(document);
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

  const documentConflicts = createDocumentConflictController({
    replaceDocumentContentInPlace:
      documents.replaceDocumentContentInPlace,
    enqueueSave,
    copyText: (text) => navigator.clipboard.writeText(text),
    refreshDerivedViews,
  });

  const openTaskDocumentMutation =
    createNotepadTaskMutationHandler({
      listReferencedNoteKeys: () =>
        workspaceStore.listReferencedNoteKeys(),
      getNoteByKey,
      replaceMarkdown: documentEditing.replaceMarkdown,
      replaceDocumentContentInPlace:
        documents.replaceDocumentContentInPlace,
      enqueueSave,
      attributeTaskActionSave,
    });

  const workspacePersistence = createWorkspacePersistenceService({
    flushAllPaneCursorSaves: () => documents.flushAllPendingCursorSaves(),
    getDocuments: () => Object.values(notepadState.notesByKey),
    cancelPendingAutosave,
    enqueueSave,
  });

  const historyMode = new HistoryModeSession({
    flushWorkspace: workspacePersistence.flushAllForNavigation,
    captureWorkspace: (paneId) => {
      const resolvedPaneId = paneId as PaneId;
      const focusTarget: HistoryWorkspaceSnapshot["focusTarget"] =
        document.activeElement === getPaneTitleInput(resolvedPaneId)
          ? "title"
          : getPaneKind(resolvedPaneId) === "chat"
            ? "chat"
            : "editor";
      return {
        activePaneId: resolvedPaneId,
        focusTarget,
        focusElement:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
      };
    },
    readTarget: (paneId) => {
      const document = getPaneDocumentSession(paneId as PaneId);
      const noteId = getDocumentNoteId(document);
      if (!noteId) return null;
      return {
        noteId,
        noteTitle: getDocumentTitle(document) || "Untitled note",
        notePath: getDocumentPath(document),
      };
    },
    restoreWorkspace: async (snapshot) => {
      const paneId = snapshot.activePaneId as PaneId;
      workspaceStore.setActivePaneId(paneId);
      await tick();
    },
    restoreFocus: async (snapshot) => {
      const paneId = snapshot.activePaneId as PaneId;
      await tick();
      if (snapshot.focusElement?.isConnected) {
        snapshot.focusElement.focus();
        return;
      }
      if (snapshot.focusTarget === "title") {
        focusTitleAtEnd(paneId);
      } else if (snapshot.focusTarget === "chat") {
        focusPaneChat(paneId);
      } else {
        focusPaneEditor(paneId);
      }
    },
    loadPage: getHistoryModePage,
    loadDiff: getHistoryModeDiff,
    nameRevision: nameHistoryRevision,
    removeRevisionName: removeHistoryRevisionName,
    clearNoteHistory,
    loadDiagnostics: getHistoryModeDiagnostics,
  });

  // ---------------------------------------------------------------------------
  // Search / related store accessors.
  // ---------------------------------------------------------------------------
  const {
    clearSearch,
    scheduleSearch,
    loadRecentNotes,
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
    if (!paneHasCapability(getPaneKind(paneId), "edit-document")) {
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

  async function disposePaneRuntime(
    paneId: PaneId,
    document: NoteDraftState | null,
  ) {
    const runtime = getPaneRuntime(paneId);
    if (document) {
      proposalOrchestrationInstance?.suspendDocument(
        document,
        editorCapabilities.get(paneId) ?? null,
      );
    }
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
    disposePaneRuntime,
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
    forgottenNoteRetentionPreference: () =>
      appSettings.forgottenNoteRetentionPreference,
    canLeaveDocument: (document) =>
      !documentHasUnresolvedConflict(document),
    onDocumentLeaving: (paneId, document) => {
      proposalOrchestrationInstance?.suspendDocument(
        document,
        editorCapabilities.get(paneId) ?? null,
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

  const {
    canSplitWorkspace,
    splitWorkspaceIfAllowed,
    openPaneChoiceInCurrent,
  } = createWorkspaceChoiceController<PaneId>({
      // Landscape phones can cross the width breakpoint without enough
      // vertical room for a useful two-pane editor.
      canSplitWorkspace: () =>
        window.innerWidth >= 640 && window.innerHeight >= 560,
      splitWorkspace: commands.splitWorkspace,
      getPendingPaneCommandId: () =>
        workspaceStore.paneCommand.paneId,
      resolvePreviousLocation: commands.resolvePreviousLocationForPaneCommand,
      resolvePaneCommandChoice: commands.resolvePaneCommandChoice,
      getActivePaneId: () => activePaneId,
      setPaneKind: commands.setPaneKind,
      goToPreviousLocation: commands.goToPreviousLocation,
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
      await documentEditing.replaceMarkdown(document, markdown, (currentMarkdown) =>
        documents.replaceEditorContentInPlace(currentMarkdown),
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
    canSplitWorkspace,
    splitWorkspace: splitWorkspaceIfAllowed,
    createSplitPane: commands.splitWorkspace,
    getPendingPaneCommandId: () => workspaceStore.paneCommand.paneId,
    resolvePaneCommandChoice: commands.resolvePaneCommandChoice,
    setPaneKind: commands.setPaneKind,
    setActivePane: workspaceStore.setActivePaneId,
    activatePane: commands.activatePane,
    openNote: commands.openNotePath,
    paneLifecycle,
    scheduleAutosave,
    refreshCurrentNote: async () => {
      await commands.refreshCurrentNoteIfChanged();
    },
    acknowledgeDocumentCommit:
      commands.acknowledgeDocumentCommit,
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
    setPaneDocument: setPaneDocumentSession,
    getPaneConversationId: (paneId) =>
      workspaceStore.getPaneState(paneId).chatConversationId,
    setPaneConversationId: (paneId, conversationId) =>
      workspaceStore.setPaneConversationId(paneId, conversationId),
    touchPaneLocation: (paneId) => touchPaneLocationForHistory(paneId),
    getPaneSelectedText: (paneId) =>
      editorCapabilities.get(paneId)?.readSelection()?.selectedText?.trim() ||
      null,
    getEditorPaneIds,
    setActivePane: workspaceStore.setActivePaneId,
    openNote: commands.openNotePath,
    openWikilink,
    flushPendingAutosave,
    getNoteSaveQueue: (document) => getNoteSaveQueue(document.key),
  });

  // Live-follow updates the chat header from the sibling editor, but the chat
  // pane's retained document is what remains after that editor closes. Keep
  // them aligned whenever the workspace layout or editor note changes.
  $effect(() => {
    for (const paneId of paneOrder) {
      getPaneKind(paneId);
      getPaneDocumentSession(paneId).key;
    }
    untrack(() => {
      chatPaneAdapter.syncRetainedContexts();
    });
  });

  // ---------------------------------------------------------------------------
  // Refresh controller (window focus / vault changes / visibility).
  // ---------------------------------------------------------------------------
  function refreshDerivedViews() {
    void loadRecentNotes();
    scheduleSearch();
    scheduleRelated({ immediate: true });
  }

  const refreshController = createNotepadRefreshController({
    getDocumentSession: () => getDocumentSession(),
    refreshDerivedViews,
    updateRelatedDrawerLayout,
    refreshDocumentFromDisk: commands.refreshDocumentFromDisk,
    getNoteByKey,
    getPaneIdsForDocument,
    replaceNoteAcrossPanes: documents.replaceNoteAcrossPanes,
    replaceReferencedNoteWithFreshDraft: (noteKey) =>
      replaceReferencedNoteWithFreshDraft(
        notepadState,
        workspaceStore,
        noteKey,
      ),
    suspendPersistenceForConflict: (document) => {
      cancelPendingAutosave(document);
      invalidatePendingSaveResults(document);
    },
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

  const titleInteractions =
    createTitleInteractionController<PaneId>({
      activatePane: activatePaneSession,
      getPaneCommandPaneId: () => paneCommandPaneId,
      resetPaneCommand: workspaceStore.resetPaneCommand,
      getPaneDocument: getPaneDocumentSession,
      updateTitle: documentEditing.updateTitle,
      clearRecentlyForgotten: () => setRecentlyForgotten(null),
      scheduleAutosave,
      flushPendingAutosave,
      scheduleDerivedViews: () => {
        scheduleSearch();
        scheduleRelated();
      },
      focusPaneEditorAtEnd,
    });

  const searchReturnFocus = createSearchReturnFocus<PaneId>({
    getActivePaneId: () => activePaneId,
    readPaneSelection: (paneId) => {
      const selection = editorCapabilities.get(paneId)?.readSelection();
      return selection
        ? { anchor: selection.anchor, head: selection.head }
        : null;
    },
    activatePane: activatePaneSession,
    focusPaneSelection: (paneId, selection) =>
      editorCapabilities
        .get(paneId)
        ?.focusSelection(selection, { scrollIntoView: false }) ?? false,
    focusPaneComposer: focusPaneChat,
  });

  const {
    handleSearchResultSelect,
    handleSearchResultNavigate,
    handleRecentTaskSelect,
    handleRelatedItemSelect,
  } = createNavigationSelectionController<PaneId>({
      getSearchMode: () => searchState.searchMode,
      clearSearch,
      resetPaneCommand: workspaceStore.resetPaneCommand,
      getNavigationPaneId,
      activatePane: activatePaneSession,
      focusSearchRange: (paneId, range) => {
        editorCapabilities.get(paneId)?.focusSearchRange(range);
      },
      saveCursorPosition: documents.saveCursorPositionForDocument,
      getOpenContext,
      getNavigationContext,
      openChatProjection: (paneId, notePath, blockAnchor) =>
        chatCoordinator.openProjection(
          paneId,
          notePath,
          blockAnchor,
        ),
      openSearchResult,
      openRecentTask,
    });

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
    togglePinCurrentNote: async () => {
      const noteId = getDocumentNoteId(getPaneDocumentSession(activePaneId));
      if (!noteId) return;
      const isPinned = searchState.pinnedNotes.some((item) => item.noteId === noteId);
      await searchState.setPinned(noteId, !isPinned);
    },
    goToPreviousLocation: commands.goToPreviousLocation,
    focusPaneAfterShortcut: commands.focusPaneAfterShortcut,
    handlePaneCommandGlobalKeydown: commands.handlePaneCommandGlobalKeydown,
    handleWikilinkKeydown,
  });

  function handleHistoryAwareGlobalKeydown(event: KeyboardEvent) {
    if (!historyMode.isActive) {
      handleGlobalKeydown(event);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void historyMode.exit();
    }
  }

  function handleHistoryAwareWindowFocus() {
    handleWindowFocus();
    if (historyMode.isActive) {
      void historyMode.refresh();
    }
  }

  function handleHistoryAwareVisibilityChange() {
    handleVisibilityChange();
    if (historyMode.isActive) {
      if (document.visibilityState === "visible") {
        void historyMode.refresh();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pane view-model + actions wired into NotepadPane.svelte.
  // ---------------------------------------------------------------------------
  const getPaneViewModel = createPaneViewModelFactory({
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getCollapsingPaneId: () => collapsingPaneId,
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    getPaneRuntime,
    getChatBindings: chatPaneAdapter.getBindings,
    isReviewingDocument: proposalOrchestration.isReviewingDocument,
    isNotePinned: (noteId) =>
      searchState.pinnedNotes.some((item) => item.noteId === noteId),
    paneTitleInputClass,
    getTransientUiState: () => activeTransientUi,
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
    onTitleFocus: titleInteractions.handleFocus,
    onTitleInput: titleInteractions.handleInput,
    onTitleBlur: titleInteractions.handleBlur,
    onTitleKeydown: titleInteractions.handleKeydown,
    onTogglePin: async (paneId) => {
      const noteId = getDocumentNoteId(getPaneDocumentSession(paneId));
      if (!noteId) return;
      const isPinned = searchState.pinnedNotes.some((item) => item.noteId === noteId);
      await searchState.setPinned(noteId, !isPinned);
    },
    onOpenHistory: (paneId) => historyMode.enter(paneId),
    onKeepMyEdits: async (paneId) => {
      await documentConflicts.keepMyEdits(
        getPaneDocumentSession(paneId),
      );
    },
    onLoadDiskVersion: async (paneId) => {
      await documentConflicts.loadDiskVersion(
        getPaneDocumentSession(paneId),
      );
    },
    onCopyMyEdits: (paneId) =>
      documentConflicts.copyMyEdits(
        getPaneDocumentSession(paneId),
      ),
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
      adoptSnapshotForPane(
        notepadState,
        workspaceStore,
        initialPaneId,
        snapshot,
      );
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
    refreshCurrentNote: async () => {
      await commands.refreshCurrentNoteFromTaskMutation();
    },
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
      void (async () => {
        await handleVaultNoteChanged(payload);
        if (historyMode.isActive) {
          await historyMode.synchronizeAfterLifecycleChange();
        }
      })();
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
  onMount(() => {
    const unregisterTaskMutation =
      registerOpenTaskDocumentMutationHandler(
        openTaskDocumentMutation,
      );
    const disposeSession = sessionLifecycle.mount();
    return () => {
      unregisterTaskMutation();
      disposeSession();
    };
  });

  // Selection tracking per pane (cursor save scheduling + related text update).
  function trackPaneSelection(paneId: PaneId) {
    return attachPaneSelectionTracking({
      paneId,
      isEditorReady: getPaneRuntime(paneId).ui.isEditorReady,
      editorRoot: getPaneRuntime(paneId).refs.editorRoot,
      isActivePaneInEditorMode: () =>
        activePaneId === paneId &&
        paneHasCapability(getPaneKind(paneId), "edit-document"),
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
  onkeydowncapture={handleHistoryAwareGlobalKeydown}
  onfocus={handleHistoryAwareWindowFocus}
  onresize={handleWindowResize}
/>
<svelte:document onvisibilitychange={handleHistoryAwareVisibilityChange} />

<div
  bind:this={workspaceShell}
  class="notepad-shell relative h-full w-full min-h-0 overflow-visible"
>
  <div
    class="contents"
    inert={historyMode.isActive}
    aria-hidden={historyMode.isActive}
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
          class={`notepad-split-border pointer-events-none absolute top-0 bottom-0 z-20 hidden w-1/2 border-2 border-border rounded-t-4xl sm:block ${
            paneOrder.indexOf(activePaneId) === 0 ? "left-0" : "right-0"
          } ${collapsingPaneId ? "notepad-split-border--hiding" : ""}`}
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
            pinnedNotes: searchState.pinnedNotes,
            recentLocations: locationHistoryItems,
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
            onPinnedNoteSelect: (result) =>
              void searchState.openRecentNoteItem(result).catch((error) => {
                console.error("Failed to open pinned note:", error);
              }),
            onSetNotePinned: (noteId, pinned) =>
              searchState.setPinned(noteId, pinned).catch((error) => {
                console.error("Failed to update pinned note:", error);
              }),
            onRecentLocationSelect: (entry) =>
              void commands
                .openLocationFromHistory(entry.location)
                .catch((error) => {
                  console.error("Failed to open recent location:", error);
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
            onSearchOpen: () => {
              searchReturnFocus.capture();
              handleSearchOpen();
              void refreshLocationHistory();
            },
            onSearchDismiss: () => {
              searchReturnFocus.restore();
            },
            onSearchCommit: () => {
              searchReturnFocus.forget();
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

  {#if activeTransientUi.kind === "slash-menu"}
    {@const slashMenuPaneId = activeTransientUi.paneId}
    <SlashMenu
      menu={getPaneRuntime(slashMenuPaneId).ui.slashMenu}
      boundsElement={getPaneRuntime(slashMenuPaneId).refs.paneCard}
    />
  {:else if activeTransientUi.kind === "selection-menu"}
    {@const selectionPaneId = activeTransientUi.paneId}
    <SelectionMenu
      menu={getPaneRuntime(selectionPaneId).ui.selectionMenu}
      boundsElement={getPaneRuntime(selectionPaneId).refs.paneCard}
    />
  {:else if activeTransientUi.kind === "wikilink-autocomplete"}
    {@const wikilinkPaneId = activeTransientUi.paneId}
    {@const wikilinkState =
      getPaneRuntime(wikilinkPaneId).ui.wikilinkAutocomplete}
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

  {#if historyMode.state.phase !== "inactive" && historyMode.state.phase !== "restoring"}
    <HistoryMode
      state={historyMode.state}
      onExit={historyMode.exit}
      onSelectRevision={historyMode.selectRevision}
      onSetComparison={historyMode.setComparison}
      onNameRevision={historyMode.nameRevision}
      onRemoveRevisionName={historyMode.removeRevisionName}
      onClearHistory={historyMode.clearHistory}
      onLoadMore={historyMode.loadMore}
      onRetry={historyMode.retry}
    />
  {:else if historyMode.state.phase === "inactive" && historyMode.state.entryError}
    <div
      class="absolute inset-x-4 top-4 z-50 mx-auto flex max-w-xl items-start gap-3 rounded-2xl border border-destructive/30 bg-card px-4 py-3 text-sm shadow-lg"
      role="alert"
      data-testid="history-entry-error"
    >
      <p class="min-w-0 flex-1">{historyMode.state.entryError}</p>
      <button
        type="button"
        class="shrink-0 font-semibold"
        onclick={historyMode.dismissEntryError}
      >Dismiss</button>
    </div>
  {/if}
</div>

<style>
  .notepad-shell {
    --editor-left-padding: 0rem;
    --editor-handle-lane-width: 2.75rem;
    --editor-right-padding: 1rem;
    /*
     * Height of the chrome floating over the top of a pane (title row, and on
     * narrow widths the absolutely positioned nav pill). The editorChromeInset
     * action measures the real thing onto each editor shell; this value only
     * covers the frame before the first measurement lands.
     */
    --editor-overlay-inset: 3.75rem;
    --editor-top-breathing-room: 1.1rem;
    /* Vertical room the bottom command bar occupies over a pane. */
    --command-bar-clearance: calc(
      5rem + env(safe-area-inset-bottom, 0px) +
        var(--keyboard-inset-height, 0px)
    );
    --editor-chrome-clearance: calc(var(--command-bar-clearance) + 2rem);
    /*
     * Scroll-past-end slack. Viewport-relative on purpose: it must not depend
     * on the pane's width, which is what the old `padding-bottom: 100%` did.
     */
    --editor-scroll-past-end: 55svh;
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
  }

  .notepad-pane {
    flex: 1 1 0;
    min-width: 0;
    opacity: 1;
    transition:
      flex-grow var(--pane-transition-duration) var(--pane-transition-ease),
      flex-basis var(--pane-transition-duration) var(--pane-transition-ease),
      opacity var(--pane-transition-duration) var(--pane-transition-ease);
  }

  .notepad-pane--collapsing {
    flex-grow: 0;
    flex-basis: 0;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .notepad-split-border {
    transition: opacity var(--pane-transition-duration) var(--pane-transition-ease);
  }

  .notepad-split-border--hiding {
    opacity: 0;
  }

  @media (min-width: 640px) {
    .notepad-shell {
      --editor-handle-lane-width: 3rem;
      --editor-right-padding: 1.4rem;
      --editor-overlay-inset: 4rem;
      --editor-top-breathing-room: 1.3rem;
      --command-bar-clearance: calc(
        6rem + env(safe-area-inset-bottom, 0px) +
          var(--keyboard-inset-height, 0px)
      );
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
    }
  }
</style>
