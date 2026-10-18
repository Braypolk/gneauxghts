<script lang="ts">
  import { registerBackgroundSave } from '$lib/app/backgroundPersistence';
  import { assertWorkspaceMutationAdmitted } from './document/documentPublicationAdmission';
  import { nextEditorFrame } from './editor/editorPresentation';
  import { workspaceDockInset } from "./ui/workspaceDockInset";
  import { onMount, tick, untrack } from "svelte";
  import { invoke } from '@tauri-apps/api/core';
  import type { ImageSearchItem } from '$lib/types/semantic';
  import { createNativeContractProbe, type NativeContractProbe } from "$lib/e2e/nativeContractProbe";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import ImageViewer from "./images/ImageViewer.svelte";
  import ExternalLinkActions from "./editor/ExternalLinkActions.svelte";
  import { createPaneLayoutMotion } from "./workspace/paneLayoutMotion";
  import { suppressResizeTransitions } from "./workspace/suppressResizeTransitions";
  import { appSettings } from "$lib/appSettings.svelte";
  import { createEditorCapabilityAdapter } from "$lib/features/notepad/editor/editorCapabilities";
  import {
    createNotepadFeatureHost,
    type NotepadFeatureHost,
  } from "$lib/features/notepad/host";
  import { focusInputAtEnd } from "$lib/features/notepad/navigation/navigation";
  import { registerPendingNoteSaveHandler } from "$lib/features/notepad/navigation/pendingNoteSave";
  import {
    navigateToPendingTaskTarget,
    openRecentTask,
    openSearchResult,
    openNoteCitation,
    type NavigationContext,
    type OpenContext,
  } from "$lib/features/notepad/navigation/openFlow";
  import { type SearchMode } from "$lib/features/notepad/search/search";
  import {
    markNoteOpened,
    saveNoteSession,
    saveTaskNoteSession,
    loadHistoryReadiness,
    type ForgottenNote,
  } from "$lib/features/notepad/session/session";
  import NotepadCommandBar from "$lib/features/notepad/ui/NotepadCommandBar.svelte";
  import NotepadPane from "$lib/features/notepad/NotepadPane.svelte";
  import type { PaneWorkspaceActions } from "$lib/features/notepad/notepadPane.types";
  import SlashMenu from "$lib/features/notepad/editor/SlashMenu.svelte";
  import SelectionMenu from "$lib/features/notepad/editor/SelectionMenu.svelte";
  import WikilinkAutocomplete from "$lib/features/notepad/wikilinks/WikilinkAutocomplete.svelte";
  import RelatedPanelHost from "$lib/features/notepad/related/RelatedPanelHost.svelte";
  import { captureFocusIntent } from "$lib/features/notepad/navigation/focusIntent";
  import {
    getCardStyle,
    getRelatedGroupStyle,
  } from "$lib/features/notepad/related/layout";
  import { createNotepadRefreshController } from "$lib/features/notepad/orchestration/notepadRefreshController";
  import { createNotepadSessionLifecycle } from "$lib/features/notepad/orchestration/notepadSessionLifecycle";
  import { mountPublicationDocumentOwner } from "$lib/features/chat/pi/publication";
  import { openPiSource } from "$lib/features/chat/pi/citations";
  import { getNearestEditorPaneId } from "$lib/features/notepad/workspace/paneRoles";
  import { NotepadChatCoordinator } from "$lib/features/notepad/orchestration/notepadChatCoordinator.svelte";
  import { createNotepadChatPaneAdapter } from "$lib/features/notepad/orchestration/notepadChatPaneAdapter";
  import { paneCommandNoteLabel } from "$lib/features/notepad/pane/paneViewModelFactory";
  import { createNotepadPersistenceController } from "$lib/features/notepad/orchestration/persistenceController";
  import { createNotepadWorkspaceSession, type LocationHistoryEntry } from "$lib/features/notepad/orchestration/notepadWorkspaceSession";
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
    bindNotepadStateToVault,
    findOpenDocument,
    getPaneNote,
    replaceReferencedNoteWithFreshDraft,
    type NoteDraftState,
    type DocumentHandle,
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
    documentCanLeaveWithoutCanonicalWrite,
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
    getHistoryModeContext,
    nameHistoryRevision,
    previewHistoryRevisionRestore,
    removeHistoryRevisionName,
    restoreHistoryRevision,
    finalizeNoteEditingWindow,
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
  type NativeE2EEditorState = {
    activePaneId: PaneId;
    workspaceOperationPending: boolean;
    paneIds: PaneId[];
    paneKind: ReturnType<typeof getPaneKind>;
    noteId: string | null;
    editor: {
      markdown: string;
      selection: { anchor: number; head: number };
      ownsWebviewFocus: boolean;
    } | null;
  };
  type NativeE2EWindow = Window & {
    __GNEAUXGHTS_NATIVE_E2E__?: {
      piNativeInvokeProbe: () => Promise<typeof import("$lib/e2e/piNativeInvokeProbe")>;
      piChat: () => Promise<import("$lib/features/chat/pi/runtime").PiChat>;
      piContext: () => Promise<typeof import("$lib/features/chat/pi/runtime").PI_CONTEXT>;
      piPublicationTask: () => Promise<typeof import("$lib/features/chat/pi/publication").PublicationTask>;
      readPiChatState: () => Array<Pick<import("$lib/features/chat/ui/piConversationView").PiViewSnapshot, "title" | "view" | "entries" | "authority" | "error" | "read" | "provider" | "model" | "initialized" | "loading"> & { paneId: PaneId; conversationId: number | null }>;
      readEditorState: () => NativeE2EEditorState;
      contractProbe: NativeContractProbe;
      openRevisionCitation: (citation: { noteId: string; label: string; notePath: string; revision: import("$lib/types/history").RevisionCitation }) => Promise<void>;
      setEditorSelection: (anchor: number, head: number) => boolean;
    };
  };
  const MAX_VISIBLE_PANES = 2;

  const paneTitleInputClass =
    "w-full bg-transparent text-center text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/55 sm:text-2xl";

  let workspaceShell = $state<HTMLDivElement | null>(null);

  // workspaceStore owns pane order, active pane, and pane command chrome.
  let paneOrder = $derived(workspaceStore.paneOrder);
  let activePaneId = $derived(workspaceStore.activePaneId);
  let collapsingPaneId = $derived(workspaceStore.collapsingPaneId);
  let paneSpaceWidth = $state(0);
  const retainedPaneIds = $derived(paneOrder.filter(id => id !== collapsingPaneId));
  // Presentation follows the actual card space (including Related's reservation).
  // Pane membership, editor mounts and the active pane remain workspace-owned.
  const compactPanes = $derived(retainedPaneIds.length > 1 && paneSpaceWidth > 0 &&
    paneSpaceWidth / retainedPaneIds.length < 360);
  // Keep compact frames/rails mounted until the workspace retires a closing
  // pane. The destination layout above still determines dock/Related space.
  const compactPaneFrames = $derived(paneOrder.length > 1 && paneSpaceWidth > 0 &&
    paneSpaceWidth / paneOrder.length < 360);
  const paneRailWidth = 48;
  const compactContentWidth = $derived(Math.max(0,
    paneSpaceWidth - paneRailWidth * (retainedPaneIds.length - 1)));
  const trailingRailWidth = $derived(compactPanes
    ? paneRailWidth * Math.max(0, retainedPaneIds.length - retainedPaneIds.indexOf(activePaneId) - 1)
    : 0);
  const leadingRailWidth = $derived(compactPanes
    ? paneRailWidth * Math.max(0, retainedPaneIds.indexOf(activePaneId))
    : 0);
  function observePaneSpace(node: HTMLElement) {
    const read = () => { paneSpaceWidth = node.clientWidth; };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return { destroy() { observer.disconnect(); } };
  }

  // The dock owns presentation only; each mounted chat keeps its composer state.
  let dockMode = $state<'search' | 'chat'>('search');
  let chatDockSlot = $state<HTMLDivElement | null>(null);
  let preferredDockChatPaneId = $state<PaneId | null>(null);
  let previousDockActiveTarget: string | null = null;
  const dockChatPaneIds = $derived(paneOrder.filter(id =>
    id !== collapsingPaneId && getPaneKind(id) === 'chat'));
  const dockChatPaneId = $derived(
    preferredDockChatPaneId && dockChatPaneIds.includes(preferredDockChatPaneId)
      ? preferredDockChatPaneId : dockChatPaneIds[0] ?? null
  );
  $effect.pre(() => {
    const available = dockChatPaneIds;
    const paneId = activePaneId;
    const activeChat = available.includes(paneId) ? paneId : null;
    const compact = compactPanes;
    untrack(() => {
      // Follow pane and kind changes at every width, while retaining explicit mode
      // choices during repeated pointer/focus activation within the same pane.
      const activeTarget = `${paneId}:${activeChat ? 'chat' : 'editor'}`;
      const paneChanged = previousDockActiveTarget !== activeTarget;
      previousDockActiveTarget = activeTarget;
      if (activeChat && (compact || paneChanged || activeChat !== preferredDockChatPaneId)) {
        preferredDockChatPaneId = activeChat;
        dockMode = 'chat';
      } else if (available.length === 0) {
        preferredDockChatPaneId = null;
        dockMode = 'search';
      } else if ((compact || paneChanged) && !activeChat) {
        dockMode = 'search';
      }
    });
  });
  function expandDockChat(paneId: PaneId) {
    if (!workspaceStore.hasPane(paneId) || getPaneKind(paneId) !== 'chat') return;
    preferredDockChatPaneId = paneId;
    dockMode = 'chat';
    commands.activatePane(paneId);
  }

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
    getCurrentTags: () => getDocumentSession().working.tags ?? [],
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

  let imageNavigation = 0;
  async function openSearchedImage(item: ImageSearchItem) {
    const request = ++imageNavigation;
    try {
      await commands.openNotePath(item.notePath, { noteId: item.noteId || null });
      await tick();
      if (request !== imageNavigation || getDocumentPath(getDocumentSession()) !== item.notePath) return;
      const currentMarkdown = getCurrentMarkdown();
      const paneId = getNavigationPaneId();
      const valid = await invoke<boolean>('validate_image_search_result', { item, currentMarkdown });
      if (request !== imageNavigation || getDocumentPath(getDocumentSession()) !== item.notePath) return;
      if (getCurrentMarkdown() !== currentMarkdown || getNavigationPaneId() !== paneId) return;
      if (!valid || !editorCapabilities.get(paneId)?.openImageViewer({ from: item.sourceStart, to: item.sourceEnd, asset: item.assetName })) {
        searchState.mediaError = 'This image occurrence changed. Search again to refresh it.';
      }
    } catch (error) { searchState.mediaError = String(error); }
  }

  const relatedState = createRelatedNotesStore({
    getCurrentTitle: () => featureHost.getActiveDocumentSnapshot().title,
    getCurrentMarkdown: () =>
      featureHost.getActiveDocumentSnapshot().bodyMarkdown,
    getCurrentPath: () =>
      featureHost.getActiveDocumentSnapshot().currentNotePath,
  });

  let paneCommandPaneId = $derived(workspaceStore.paneCommand.paneId);
  let paneCommandSourceDocumentHandle = $derived(
    workspaceStore.paneCommand.sourceDocumentHandle,
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

  const chatCoordinator = new NotepadChatCoordinator<PaneId>(initialPaneIds, {
    getActivePaneId: () => activePaneId,
    getPaneKind,
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
      chatCoordinator.ensureBinding(paneId);
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

  function getDocumentByHandle(documentHandle: DocumentHandle) {
    return notepadState.documentsByHandle[documentHandle] ?? null;
  }

  function getPaneDocumentSession(paneId: PaneId) {
    return getPaneNote(notepadState, workspaceStore, paneId);
  }

  function setPaneDocumentSession(paneId: PaneId, document: NoteDraftState) {
    workspaceStore.setPaneDocumentHandle(paneId, document.handle);
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

  const getEditorPaneIds = () => workspaceStore.getEditorPaneIds();
  const getNavigationPaneId = () => workspaceStore.getNavigationPaneId();
  const getNextPaneId = (paneId = workspaceStore.activePaneId, direction: 1 | -1 = 1) => workspaceStore.getNextPaneId(paneId, direction);
  const getPaneIdsForDocument = (document: NoteDraftState) => workspaceStore.getPaneIdsForDocument(document.handle);
  const getVisiblePaneIds = () => workspaceStore.paneOrder;

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
      getWikilinkState: (paneId) =>
        getPaneRuntime(paneId).ui.wikilinkAutocomplete,
    });

  function focusTitleAtEnd(paneId: PaneId = getNavigationPaneId()) {
    focusInputAtEnd(getPaneTitleInput(paneId));
  }

  const navigationLifetime = new AbortController();

  function getNavigationContext(
    paneId: PaneId = getNavigationPaneId(),
  ): NavigationContext {
    const paneDocument = getPaneDocumentSession(paneId);
    const editorRoot = getPaneEditorRoot(paneId);
    return {
      signal: navigationLifetime.signal,
      isCurrent: () => getVisiblePaneIds().includes(paneId) &&
        getPaneDocumentSession(paneId).handle === paneDocument.handle &&
        getPaneEditorRoot(paneId) === editorRoot,
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
  $effect(() => {
    if (historyMode.isActive) {
      transientUi.closeImageViewer();
      transientUi.closeExternalLinkActions();
    }
  });

  const paneControllerSetupDeps: PaneControllerSetupDeps<PaneId> = {
    openExternalLinkActions: (paneId, session) => { if (!historyMode.isActive) transientUi.openExternalLinkActions(paneId, session); },
    openImageViewer: (paneId, session) => { if (!historyMode.isActive) transientUi.openImageViewer(paneId, session); },
    getPaneRuntime,
    getPaneDocument: getPaneDocumentSession,
    activatePaneSession,
    cancelPendingAutosave: (note) => cancelPendingAutosave(note),
    closeEditorTransientUi: (paneId) => {
      transientUi.closeExternalLinkActions(paneId);
      transientUi.closeImageViewer(paneId);
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

  function isTitleInputFocusedForNote(note: NoteDraftState) {
    for (const paneId of getPaneIdsForDocument(note)) {
      const titleInput = getPaneTitleInput(paneId);
      if (titleInput && document.activeElement === titleInput) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Pane editor sessions serialize mount, swap, replacement and destruction.
  // ---------------------------------------------------------------------------
  let previousWorkspaceSettled = $state(false);
  function paneShouldMountEditor(paneId: PaneId): boolean {
    return (
      previousWorkspaceSettled &&
      notepadRuntimeState.hasLoadedInitialSession &&
      paneOrder.includes(paneId) &&
      workspaceStore.hasPane(paneId) &&
      paneHasCapability(getPaneKind(paneId), "edit-document")
    );
  }

  const paneLifecycle = createPaneEditorLifecycle<PaneId>({
    getPaneIds: () => getVisiblePaneIds(),
    getPaneRuntime,
    getEditorLifecycleController: (paneId) =>
      getPaneControllers(paneId).editorLifecycleController,
    getPaneDocument: getPaneDocumentSession,
    paneShouldMountEditor,
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
    getDocumentByHandle,
  });

  let persistence: ReturnType<typeof createNotepadPersistenceController>;
  let agentPublicationActive = $state(false);
  const documentEditing = createDocumentEditingService<PaneId>({
    state: notepadState,
    isApplyingProgrammaticUpdate: (document) =>
      getPaneIdsForDocument(document).some(
        (paneId) => getPaneRuntime(paneId).ui.isApplyingProgrammaticUpdate,
      ),
    isTitleEditing: isTitleInputFocusedForNote,
    publicationAdmissionChanged: (active) => { agentPublicationActive = active; },
    isWorkspaceOperationPending: () => commands.isOperationPending() || historyMode.state.phase !== 'inactive',
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
    clearSelectedRelatedText,
    scheduleAutosave: (document) => persistence.scheduleAutosave(document),
    scheduleSearch: searchState.scheduleSearch,
    scheduleRelated: relatedState.scheduleRelated,
  });

  persistence = createNotepadPersistenceController({
    getDocumentSession,
    saveNoteSession,
    saveTaskNoteSession,
    loadHistoryReadiness,
    markNoteOpened,
    documentEditing,
    isActiveNote: (note) => getDocumentSession() === note,
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

  ensurePaneControllers(initialPaneId);

  const documentConflicts = createDocumentConflictController({
    replaceDocumentContentInPlace:
      documents.replaceDocumentContentInPlace,
    enqueueSave,
    resolveUsingExternal: documentEditing.resolveUsingExternal,
    copyText: (text) => navigator.clipboard.writeText(text),
    refreshDerivedViews,
  });

  const openTaskDocumentMutation =
    createNotepadTaskMutationHandler({
      listReferencedDocumentHandles: () =>
        workspaceStore.listReferencedDocumentHandles(),
      getDocumentByHandle,
      replaceMarkdown: documentEditing.replaceMarkdown,
      replaceDocumentContentInPlace:
        documents.replaceDocumentContentInPlace,
      enqueueSave,
      attributeTaskActionSave,
    });

  const workspacePersistence = createWorkspacePersistenceService({
    flushAllPaneCursorSaves: () => documents.flushAllPendingCursorSaves(),
    getDocuments: () => Object.values(notepadState.documentsByHandle),
    cancelPendingAutosave,
    enqueueSave,
  });

  const historyMode = new HistoryModeSession({
    finalizeWindow: finalizeNoteEditingWindow,
    flushWorkspace: workspacePersistence.flushAllForNavigation,
    captureWorkspace: (paneId) => {
      assertWorkspaceMutationAdmitted(notepadState);
      const resolvedPaneId = paneId as PaneId;
      const editorViewState = paneLifecycle.captureViewState(resolvedPaneId);
      const paneDocument = getPaneDocumentSession(resolvedPaneId);
      const editorNoteId = getDocumentNoteId(paneDocument);
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
        editor: editorViewState && editorNoteId
          ? {
              noteId: editorNoteId,
              viewState: editorViewState,
            }
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
    restoreEditorState: async (snapshot) => {
      if (!snapshot.editor) return;
      const paneId = snapshot.activePaneId as PaneId;
      const paneDocument = getPaneDocumentSession(paneId);
      if (getDocumentNoteId(paneDocument) !== snapshot.editor.noteId) {
        throw new Error("The original note is no longer open in its pane.");
      }
      const outcome = await paneLifecycle.restoreViewState(
        paneId,
        paneDocument,
        snapshot.editor.viewState,
      );
      if (outcome !== "applied") {
        throw new Error(`The editor view is ${outcome}.`);
      }
    },
    restoreFocus: async (snapshot) => {
      const paneId = snapshot.activePaneId as PaneId;
      await tick();
      if (
        snapshot.focusTarget === "editor" &&
        snapshot.focusElement === getPaneRuntime(paneId).controller?.view.contentDOM
      ) {
        // CodeMirror owns both its DOM selection and focus bookkeeping. Native
        // WebKit can publish a stale selection when contentDOM.focus() bypasses it.
        focusPaneEditor(paneId);
        return;
      }
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
    loadContext: getHistoryModeContext,
    loadDiff: getHistoryModeDiff,
    loadRestorePreview: previewHistoryRevisionRestore,
    restoreRevision: (noteId, revisionId, expectedCurrentAuthoredContentHash) => {
      assertWorkspaceMutationAdmitted(notepadState);
      return restoreHistoryRevision(
        noteId,
        revisionId,
        expectedCurrentAuthoredContentHash,
      );
    },
    adoptRestoredRevision: async (restored) => {
      await documentEditing.adoptVersionRestore(restored);
    },
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
    getDocumentSession().handle;
    untrack(() => {
      syncCurrentFileSearchHighlights();
    });
  });

  const paneLayoutMotion = createPaneLayoutMotion({
    getShell: () => workspaceShell,
    updateRelatedLayout: () => updateRelatedDrawerLayoutController(workspaceShell),
  });

  $effect.pre(() => {
    const target = paneOrder.filter(id => id !== collapsingPaneId)
      .map(id => `${id}:${getPaneKind(id)}`).join(",");
    const rail = compactPanes ? activePaneId : undefined;
    const ready = notepadRuntimeState.hasLoadedInitialSession;
    untrack(() => paneLayoutMotion.update({ panes: target, rail },
      ready && !workspaceShell?.hasAttribute('data-window-resizing')));
  });

  async function waitForPaneMotion() {
    await paneLayoutMotion.wait();
    // Native inert/style propagation settles with paint after retained frames
    // change sides. Focus only after that boundary and recheck activation.
    if (compactPanes) {
      // A frame callback runs before paint. Cross a paint before focusing a
      // newly non-inert retained subtree, as editor restoration already does.
      await nextEditorFrame();
      await nextEditorFrame();
    }
  }

  async function expandPaneRail(paneId: PaneId) {
    const focusIntent = captureFocusIntent();
    try {
      commands.activatePane(paneId);
      await tick();
      await waitForPaneMotion();
      if (workspaceShell?.isConnected && activePaneId === paneId && focusIntent.isCurrent()) {
        commands.focusPaneAfterShortcut(paneId);
      }
    } finally {
      focusIntent.dispose();
    }
  }

  $effect(() => {
    const compact = compactPanes;
    const paneId = activePaneId;
    if (compact) untrack(() => closeTransientUiExcept(paneId));
  });

  function updateRelatedDrawerLayout() {
    if (!paneLayoutMotion.running) {
      updateRelatedDrawerLayoutController(workspaceShell);
    }
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
    paneLayoutMotion.retarget();
  }

  function closeRelatedPanel() {
    collapseRelatedPanelController(workspaceShell);
    paneLayoutMotion.retarget();
  }

  async function disposePaneRuntime(
    paneId: PaneId,
    document: NoteDraftState | null,
  ) {
    const runtime = getPaneRuntime(paneId);
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
  // setKind / pane-command / switch-pane). Owned by the workspace session so
  // the component does not own every flow body.
  // ---------------------------------------------------------------------------
  const commands = createNotepadWorkspaceSession({
    state: notepadState,
    workspace: workspaceStore,
    maxVisiblePanes: MAX_VISIBLE_PANES,
    canSplitWorkspace: () => window.innerWidth >= 640 && window.innerHeight >= 560,
    persistence,
    documents,
    documentEditing,
    paneLifecycle,
    presentation: {
      getPaneTitleInput,
      focusPaneEditor,
      focusPaneEditorAtEnd,
      focusPaneChat,
      createPane: createPaneRuntime,
      disposePaneRuntime,
      closeTransientUiExcept,
      updateSelectedRelatedText,
      closeWikilinkAutocomplete,
      waitForPaneMotion,
    },
    derivedViews: {
      clearSearch,
      scheduleSearchIfNeeded: scheduleSearch,
      scheduleRelatedIfNeeded: scheduleRelated,
      clearSelectedRelatedText,
      loadRecentNotes,
    },
    forgottenNoteRetentionPreference: () =>
      appSettings.forgottenNoteRetentionPreference,

  });
  touchPaneLocationForHistory = commands.touchCurrentLocation;
  commands.setLocationHistoryEpochListener((epoch) => {
    locationHistoryEpoch = epoch;
  });

  const {
    splitWorkspaceIfAllowed,
    openPaneChoiceInCurrent,
  } = createWorkspaceChoiceController<PaneId>({
      // Explicit narrow splits use retained pane rails. Inset, short windows
      // keep their existing split policy.
      canSplitWorkspace: () =>
        window.innerWidth < 640 || window.innerHeight >= 560,
      splitWorkspace: commands.splitWorkspace,
      getActivePaneId: () => activePaneId,
      setPaneKind: commands.setPaneKind,
      goToPreviousLocation: commands.goToPreviousLocation,
    });

  let paneCommandCurrentNoteLabel = $derived.by(() => {
    void locationHistoryEpoch;
    if (paneCommandPaneId === null) {
      return paneCommandNoteLabel(
        paneCommandSourceDocumentHandle ? notepadState.documentsByHandle[paneCommandSourceDocumentHandle] : null,
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
    if (!notepadRuntimeState.hasLoadedInitialSession) return;
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

  const chatPaneAdapter = createNotepadChatPaneAdapter<PaneId>({
    coordinator: chatCoordinator,
    getPaneOrder: () => paneOrder,
    getPaneKind,
    getPaneDocument: getPaneDocumentSession,
    setPaneDocument: setPaneDocumentSession,
    getPaneConversationId: (paneId) =>
      workspaceStore.getPaneState(paneId).chatConversationId,
    setPaneConversationId: (paneId, conversationId) =>
      workspaceStore.setPaneConversationId(paneId, conversationId),
    touchPaneLocation: (paneId) => touchPaneLocationForHistory(paneId),
    openSource: async (paneId, authorityId, sourceId) => {
      assertWorkspaceMutationAdmitted(notepadState);
      const destination = await openPiSource(authorityId, sourceId);
      assertWorkspaceMutationAdmitted(notepadState);
      if (destination.kind === "unavailable") throw new Error(destination.message);
      const target = getNearestEditorPaneId(paneOrder, getPaneKind, paneId) ?? paneId;
      workspaceStore.setActivePaneId(target);
      const revealed = await openNoteCitation({ ...getOpenContext(), openNotePath: (noteId, path, options) => commands.openNotePath(path, { ...options, noteId, revealEditorAfterOpen: true }) },
        () => getNavigationContext(target), destination);
      if (destination.location && !revealed) return "The cited passage is unavailable in the current editor. Opened the note without selecting a passage.";
      return destination.limitation;
    },
  });

  // Live-follow updates the chat header from the sibling editor, but the chat
  // pane's retained document is what remains after that editor closes. Keep
  // them aligned whenever the workspace layout or editor note changes.
  $effect(() => {
    for (const paneId of paneOrder) {
      getPaneKind(paneId);
      getPaneDocumentSession(paneId).handle;
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
    findOpenDocumentByPath: (notePath) =>
      findOpenDocument(notepadState, {
        noteId: null,
        path: notePath
      }),
    getPaneIdsForDocument,
    replaceNoteAcrossPanes: documents.replaceNoteAcrossPanes,
    replaceReferencedNoteWithFreshDraft: (documentHandle) =>
      replaceReferencedNoteWithFreshDraft(
        notepadState,
        workspaceStore,
        documentHandle,
      ),
    suspendPersistenceForConflict: (document) => {
      cancelPendingAutosave(document);
      invalidatePendingSaveResults(document);
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
      resetPaneCommand: workspaceStore.resetPaneCommand,
      getNavigationPaneId,
      activatePane: activatePaneSession,
      focusSearchRange: (paneId, range, options) => {
        editorCapabilities.get(paneId)?.focusSearchRange(range, options);
      },
      saveCursorPosition: documents.saveCursorPositionForDocument,
      getOpenContext,
      getNavigationContext,
      openSearchResult,
      openRecentTask,
    });

  const handleGlobalKeydown = createWorkspaceShortcutHandler<PaneId>({
    getPaneOrder: () => paneOrder,
    getActivePaneId: () => activePaneId,
    getPaneTitleInput,
    openThoughtPartner: () => openPaneChoiceInCurrent("thoughtPartner"),
    showHistory: async () => {
      if (getPaneKind(activePaneId) !== "editor") return;
      await historyMode.enter(activePaneId);
    },
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
    if (agentPublicationActive) { event.preventDefault(); return; }
    // History owns its keyboard handling, including Escape in inline renaming.
    // Capturing Escape here would close history before the field can cancel it.
    if (!historyMode.isActive && activeTransientUi.kind !== "image-viewer") {
      handleGlobalKeydown(event);
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
    getChatBindings: chatPaneAdapter.getBindings,
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
    onNoteOptionsOpen: () => {
      transientUi.closeExternalLinkActions();
      transientUi.closeSlashMenu();
      transientUi.closeSelectionMenu();
      transientUi.closeWikilinkAutocomplete();
    },
    onUpdateTags: (paneId, documentHandle, tags) => {
      const document = getPaneDocumentSession(paneId);
      if (document.handle === documentHandle) documentEditing.updateTags(document, tags);
    },
    onOpenHistory: (paneId) => historyMode.enter(paneId),
    onOpenFileLocation: async (paneId) => {
      const path = getDocumentPath(getPaneDocumentSession(paneId));
      if (!path) return;
      try {
        await revealItemInDir(path);
      } catch (error) {
        console.error("Failed to open file location:", error);
        window.alert("Could not open the file location. Please try again.");
      }
    },
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
    bindVaultScope: (vaultRoot) =>
      bindNotepadStateToVault(notepadState, vaultRoot),
    applyAssetRoot: updateSharedEditorResourceConfig,
    registerWindowCloseHandler: () =>
      registerWorkspaceWindowCloseHandler({
        getPaneOrder: () => paneOrder,
        getActivePaneId: () => activePaneId,
        getPaneTitleInput,
        closePane: async (paneId) => {
          if (historyMode.isActive) return;
          await commands.closePane(paneId);
        },
        focusPaneAfterShortcut: commands.focusPaneAfterShortcut,
      }),
    registerPendingSaveHandler: () =>
      registerPendingNoteSaveHandler(async () => {
        await historyMode.waitForPendingRestore();
        await workspacePersistence.flushAllForNavigation();
      }),
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
      navigationLifetime.abort();
      commands.dispose();
      documents.saveCursorPositionForDocument();
      // Browser history and modified/default anchor navigation can bypass the
      // app-shell barrier. Keep this best-effort defensive flush until those
      // platform departure routes can be synchronously vetoed.
      void workspacePersistence.flushAllForNavigation();
      chatCoordinator.dispose();
      syncCurrentFileSearchHighlights("", "all");
      searchState.dispose();
      relatedState.dispose();
      void paneLifecycle.disposeAll();
    },
  });
  onMount(() => {
    const publicationOwner = mountPublicationDocumentOwner(documentEditing);
    void publicationOwner.ready.catch(error => console.error("Publication owner could not open:", error));
    const unregisterBackgroundSave = registerBackgroundSave(async () => {
      await historyMode.waitForPendingRestore();
      await workspacePersistence.flushAllForBackground();
    });
    const unregisterTaskMutation =
      registerOpenTaskDocumentMutationHandler(
        openTaskDocumentMutation,
      );
    let mounted = true;
    let disposeSession = () => {};
    // The shared document state may still be protected by the retired workspace.
    // A new native bind failure does not prevent ordinary editor initialization.
    void publicationOwner.previousOwnerSettled.then(() => {
      if (mounted) {
        previousWorkspaceSettled = true;
        disposeSession = sessionLifecycle.mount();
      }
    }).catch(error => console.error("The previous workspace could not settle:", error));
    let disposeNativeE2EBridge: (() => void) | null = null;
    // Explicit E2E builds include inspection, selection and citation actions in
    // optimized native tests too; ordinary builds erase this branch.
    if (import.meta.env.VITE_E2E_NATIVE === "true" || import.meta.env.VITE_E2E_BROWSER === "true") {
      const nativeE2EWindow = window as NativeE2EWindow;
      const contractProbe = createNativeContractProbe();
      const nativeE2EBridge = {
        contractProbe,
        piNativeInvokeProbe: () => import("$lib/e2e/piNativeInvokeProbe"),
        piChat: () => import("$lib/features/chat/pi/runtime").then(module => module.openPiChat()),
        piContext: () => import("$lib/features/chat/pi/runtime").then(module => module.PI_CONTEXT),
        piPublicationTask: () => import("$lib/features/chat/pi/publication").then(module => module.PublicationTask),
        readPiChatState: () => paneOrder.filter(id => getPaneKind(id) === "chat").map(paneId => {
          const value = chatCoordinator.getBinding(paneId).getSnapshot();
          return { paneId, conversationId: value.conversation?.id ?? null, title: value.title, view: value.view, entries: value.entries, authority: value.authority, error: value.error, read: value.read, provider: value.provider, model: value.model, initialized: value.initialized, loading: value.loading };
        }),
        readEditorState: () => {
          const paneId = activePaneId;
          const paneDocument = getPaneDocumentSession(paneId);
          const controller = getPaneRuntime(paneId).controller;
          const snapshot = editorCapabilities.get(paneId)?.readSnapshot() ?? null;
          return {
            activePaneId: paneId,
            workspaceOperationPending: commands.isOperationPending() || historyMode.state.phase !== 'inactive',
            paneIds: [...paneOrder],
            paneKind: getPaneKind(paneId),
            noteId: getDocumentNoteId(paneDocument),
            editor: snapshot && controller
              ? {
                  markdown: snapshot.markdown,
                  selection: snapshot.selection,
                  ownsWebviewFocus:
                    document.activeElement === controller.view.contentDOM,
                }
              : null,
          };
        },
        openRevisionCitation: async (citation: { noteId: string; label: string; notePath: string; revision: import("$lib/types/history").RevisionCitation }) =>
          historyMode.enterCitation(activePaneId, { noteId: citation.noteId, noteTitle: citation.label, notePath: citation.notePath }, citation.revision!.revisionId),
        setEditorSelection: (anchor: number, head: number) =>
          editorCapabilities.get(activePaneId)?.focusSelection(
            { anchor, head },
            { scrollIntoView: false },
          ) ?? false,
      };
      nativeE2EWindow.__GNEAUXGHTS_NATIVE_E2E__ = nativeE2EBridge;
      disposeNativeE2EBridge = () => {
        contractProbe.dispose();
        if (nativeE2EWindow.__GNEAUXGHTS_NATIVE_E2E__ === nativeE2EBridge) {
          delete nativeE2EWindow.__GNEAUXGHTS_NATIVE_E2E__;
        }
      };
    }
    return () => {
      mounted = false;
      previousWorkspaceSettled = false;
      unregisterBackgroundSave();
      paneLayoutMotion.cancel();
      disposeNativeE2EBridge?.();
      unregisterTaskMutation();
      // Retain concrete document resources until native publication effects settle.
      void publicationOwner.close(() => disposeSession()).catch(error => {
        console.error("Publication owner could not close; document resources remain retained:", error);
      });
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
  use:suppressResizeTransitions
  class="notepad-shell relative h-full w-full min-h-0 overflow-visible"
>
  <div
    class="contents"
    inert={historyMode.isActive || agentPublicationActive}
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
      class="notepad-workspace-card relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-b border-border text-card-foreground shadow-sm workspace-card-motion sm:rounded-4xl sm:border"
      style={getCardStyle(relatedState.panelPlacement)}
      data-testid="workspace-card"
    >
      <div
        class="pointer-events-none absolute inset-0 bg-card/55 backdrop-blur-xl"
      ></div>

      <div class="relative z-10 flex min-h-0 min-w-0 flex-1 gap-0 px-0 pt-0"
        use:observePaneSpace data-compact-panes={compactPaneFrames || undefined}
        style={`--pane-rail-width:${paneRailWidth}px;--compact-pane-content-width:${compactContentWidth}px;`}>
        {#each paneOrder as paneId (paneId)}
          <NotepadPane
            pane={getPaneRuntime(paneId)}
            viewModel={getPaneViewModel(paneId)}
            actions={paneActions}
            mobileTitleActive={paneId === activePaneId && !historyMode.isActive}
            compact={compactPaneFrames}
            collapsed={compactPaneFrames && (collapsingPaneId
              ? paneId === collapsingPaneId : paneId !== activePaneId)}
            onExpand={() => void expandPaneRail(paneId)}
            composerDock={{
              slot: paneId === dockChatPaneId ? chatDockSlot : null,
              expanded: paneId === dockChatPaneId && dockMode === 'chat',
              onExpand: () => expandDockChat(paneId),
            }}
            bind:paneCommandFocusRoot={paneCommandFocusEl}
          />
        {/each}
      </div>

      <div
        class="absolute right-0 left-0 z-30 bottom-(--keyboard-inset-height)"
        use:workspaceDockInset
      >
        <NotepadCommandBar
          chatAvailable={dockChatPaneId !== null}
          {dockMode}
          bind:chatSlot={chatDockSlot}
          onDockModeChange={(mode) => (dockMode = mode)}
          onExpandChat={() => {
            if (dockChatPaneId) chatCoordinator.focusComposer(dockChatPaneId);
          }}
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
            imageResults: searchState.imageResults,
            imageQueryUrl: searchState.imageQueryUrl,
            mediaError: searchState.mediaError,
            onQueryImage: searchState.chooseQueryImage,
            onSearchClear: searchState.clearSearch,
            onImageSelect: openSearchedImage,
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

    {#if !historyMode.isActive && relatedState.panelPlacement === "side"}
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

  {#if !historyMode.isActive && !isActivePaneChat && relatedState.panelPlacement !== "side"}
    <RelatedPanelHost
      rightInset={trailingRailWidth}
      leftInset={leadingRailWidth}
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

  {#if activeTransientUi.kind === "image-viewer"}
    {#key activeTransientUi.session}
      <ImageViewer session={activeTransientUi.session} onClose={() => transientUi.closeImageViewer()} />
    {/key}
  {:else if activeTransientUi.kind === "external-link-actions"}
    {#key activeTransientUi.session}
      <ExternalLinkActions session={activeTransientUi.session} onClose={() => transientUi.closeExternalLinkActions()} />
    {/key}
  {/if}

  {#if historyMode.state.phase !== "inactive" && historyMode.state.phase !== "restoring"}
    <!-- Match the editor card's bounds, including the space reserved for Related. -->
    <div
      class="history-workspace-overlay absolute inset-y-0 left-0 z-50 workspace-card-motion"
      style={`${getRelatedGroupStyle(relatedState.panelPlacement, relatedState.reservedWidth)} ${getCardStyle(relatedState.panelPlacement)}`}
    >
      <HistoryMode
        state={historyMode.state}
        onExit={historyMode.exit}
        onSelectRevision={historyMode.selectRevision}
        onSetComparison={historyMode.setComparison}
        onPreviewRestore={historyMode.previewRestore}
        onCancelRestore={historyMode.cancelRestore}
        onConfirmRestore={historyMode.confirmRestore}
        onNameRevision={historyMode.nameRevision}
        onRemoveRevisionName={historyMode.removeRevisionName}
        onClearHistory={historyMode.clearHistory}
        onCheckHealth={historyMode.checkHealth}
        onLoadMore={historyMode.loadMore}
        onLoadNewer={historyMode.loadNewer}
        onRetry={historyMode.retry}
      />
    </div>
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
      var(--workspace-dock-height, 5rem) +
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
      var(--command-bar-clearance) + 1.1rem
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

  /* Pane changes share one geometry animation; ordinary Related toggles keep
     their own transition when this temporary marker is absent. */
  .notepad-shell:global([data-pane-motion]) .notepad-workspace-card,
  .notepad-shell:global([data-pane-motion]) :global(.related-drawer) {
    transition: none;
  }

  /* Window geometry must settle immediately, including the History overlay. */
  .notepad-shell:global([data-window-resizing]) :global(.workspace-card-motion),
  .notepad-shell:global([data-window-resizing]) :global(.related-drawer-motion) {
    transition: none;
  }

  @media (max-width: 639px), (any-pointer: coarse) and (max-height: 559px) {
    .notepad-shell {
      --editor-overlay-inset: calc(4rem + var(--app-shell-top-inset, 0px));
      --related-sheet-top: var(--editor-overlay-inset);
    }
    .history-workspace-overlay { top: var(--app-shell-top-inset, 0px); }
  }

  @media (min-width: 640px) {
    .notepad-shell {
      --editor-handle-lane-width: 3rem;
      --editor-right-padding: 1.4rem;
      --editor-overlay-inset: 4rem;
      --editor-top-breathing-room: 1.3rem;
      --command-bar-clearance: calc(
        var(--workspace-dock-height, 6rem) +
          var(--keyboard-inset-height, 0px)
      );
    }
  }

  @media (min-width: 768px) {
    .notepad-shell {
      --editor-left-padding: 0.75rem;
    }
  }
  @media (any-pointer: coarse) and (orientation: landscape) {
    :global(.app-shell[data-keyboard-open='true']) .notepad-shell {
      --editor-top-breathing-room: 0.25rem;
      --editor-chrome-clearance: var(--command-bar-clearance);
      --related-sheet-top: 0px;
      --related-bottom-offset: calc(100% - 2.75rem);
    }
  }

  @media (any-pointer: coarse) and (orientation: landscape) {
    :global(.app-shell[data-keyboard-open='true']) :global(.related-bottom-sheet > div > button) { right: 4rem; }
  }

  @media (min-width: 1280px) {
    .notepad-shell {
      --editor-handle-lane-width: 3.1rem;
      --editor-right-padding: 1.8rem;
    }
  }
</style>
