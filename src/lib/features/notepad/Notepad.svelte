<script lang="ts">
  import { type UnlistenFn } from '@tauri-apps/api/event';
  import { onMount, tick, untrack } from 'svelte';
  import { chatApi } from '$lib/features/chat/api';
  import { createChatController, type ChatController } from '$lib/features/chat/controller';
  import type { ChatSelection, ChatSelectionActions } from '$lib/features/chat/types';
  import {
    formatDiscussionDraft,
    type ChatDraftSeed
  } from '$lib/features/chat/discussionContext';
  import { forgottenNoteRetentionPreference } from '$lib/appSettings';
  import {
    focusEditorSearchRange,
    setEditorCurrentSearchHighlightQuery
  } from '$lib/features/notepad/editor/editor';
  import { createEditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
  import {
    createNotepadFeatureHost,
    type NotepadFeatureHost
  } from '$lib/features/notepad/host';
  import { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
  import { shouldSuppressAutosaveForDocument } from '$lib/features/proposals/reviewHold.svelte';
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
  import NotepadCommandBar from '$lib/features/notepad/ui/NotepadCommandBar.svelte';
  import NotepadPane from '$lib/features/notepad/NotepadPane.svelte';
  import type {
    PaneViewModel,
    PaneWorkspaceActions
  } from '$lib/features/notepad/notepadPane.types';
  import SlashMenu from '$lib/features/notepad/editor/SlashMenu.svelte';
  import SelectionMenu from '$lib/features/notepad/editor/SelectionMenu.svelte';
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
    getSplitSourceNote,
    paneCommandNoteLabel
  } from '$lib/features/notepad/orchestration/paneSessionController';
  import { createNotepadPersistenceController } from '$lib/features/notepad/orchestration/persistenceController';
  import {
    createNotepadCommands,
    type LocationHistoryEntry
  } from '$lib/features/notepad/orchestration/notepadCommands';
  import {
    createNotepadWorkspaceCommands,
    type NotepadDerivedViewCommands,
    type NotepadPaneCommands
  } from '$lib/features/notepad/orchestration/notepadCommandFacades';
  import { createRelatedNotesStore } from '$lib/features/notepad/related/store';
  import { createNotepadSearchStore } from '$lib/features/notepad/search/store.svelte';
  import { attachPaneSelectionTracking } from '$lib/features/notepad/editor/paneSelectionTracking';
  import type { PaneCommandChoice } from '$lib/features/notepad/paneCommandPicker';
  import {
    createPaneControllers as createPaneControllersFn,
    type PaneControllerSetupDeps
  } from '$lib/features/notepad/pane/paneControllers';
  import {
    getPaneIdForSlashMenuView,
    setSlashMenuListener
  } from '$lib/features/notepad/editor/slashMenuBridge';
  import {
    getPaneIdForSelectionMenuView,
    setSelectionMenuListener
  } from '$lib/features/notepad/editor/selectionMenuBridge';
  import {
    slashMenuHideFromUi,
    type SlashMenuSnapshot
  } from '$lib/features/notepad/editor/slashMenu';
  import {
    selectionMenuHideFromUi,
    type SelectionMenuSnapshot
  } from '$lib/features/notepad/editor/selectionMenu';
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
    setPaneChatConversationId,
    setPaneKind as setStoredPaneKind,
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
  import { consumePendingNoteTarget } from '$lib/noteNavigation';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';
  import { formatNoteTitle } from '$lib/features/notepad/model/document';
  import { formatShortcutBinding, keyboardShortcutBindings } from '$lib/keyboardShortcuts';
  import type { EditorSnapshot } from '$lib/features/notepad/editor/editor';
  import '$lib/features/notepad/editor/editor.css';
  import '$lib/features/notepad/editor/editorTypography.css';
  import '$lib/features/notepad/markdown/inlineFormatting.css';

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
  const chatControllers = new Map<PaneId, ChatController>();
  let chatDraftSeeds = $state<Partial<Record<PaneId, ChatDraftSeed>>>({});
  let chatTargetAnchors = $state<Partial<Record<PaneId, string | null>>>({});
  let discussionSeedCounter = 0;
  let discussionInProgress = false;
  let activeSlashMenuPaneId = $state<PaneId | null>(null);
  let activeSelectionMenuPaneId = $state<PaneId | null>(null);
  let activeWikilinkPaneId = $state<PaneId | null>(null);
  let featureHost: NotepadFeatureHost;
  /** Assigned after `commands` is created; used by early chat open helpers. */
  let touchPaneLocationForHistory: (paneId: PaneId) => void = () => {};

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
    onSearchHighlightsChange: ({ searchMode, searchQuery, matchCase, matchWholeWord }) => {
      currentSearchHighlightMode = searchMode;
      currentSearchHighlightQuery = searchQuery;
      syncCurrentFileSearchHighlights(searchQuery, searchMode, { matchCase, matchWholeWord });
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
    return ensurePaneRuntime(paneId);
  }

  function getChatController(paneId: PaneId) {
    let controller = chatControllers.get(paneId);
    if (!controller) {
      controller = createChatController(chatApi, {
        onAssistantCompleted: async ({ conversation, message }) => {
          if (conversation.mode !== 'make') return;
          // proposalOrchestration is initialized later in this module; by the
          // time chat completions fire, the composition root is fully set up.
          const orchestration = getProposalOrchestration();
          await orchestration.loadFromMakeModeMessage(message.content);
        }
      });
      chatControllers.set(paneId, controller);
    }
    return controller;
  }

  let proposalOrchestrationInstance: ReturnType<typeof createProposalOrchestration> | null =
    null;
  function getProposalOrchestration() {
    if (!proposalOrchestrationInstance) {
      throw new Error('Proposal orchestration is not ready yet.');
    }
    return proposalOrchestrationInstance;
  }

  function formatChatInsertion(selection: ChatSelection) {
    const quote = selection.text
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    const backlink = selection.linkTarget ? `[[${selection.linkTarget}|Open in chat]]` : '';
    return `${quote}${backlink ? `\n> — ${backlink}` : ''}\n\n`;
  }

  function chatSelectionActions(): ChatSelectionActions {
    return {
      onInsertIntoNote: async (selection) => {
        const destinationPaneId = getEditorPaneIds()[0];
        if (!destinationPaneId) {
          throw new Error('Open a note beside the conversation before inserting.');
        }
        const document = getPaneDocumentSession(destinationPaneId);
        const result = featureHost.insertMarkdown({
          noteKey: document.key,
          expectedDocumentRevision: document.operationRevision,
          markdown: formatChatInsertion(selection),
          target: 'selection',
          focus: true,
          scrollIntoView: true
        });
        if (result.status === 'target-changed') {
          throw new Error('The destination note changed. Choose the note and try again.');
        }
        if (result.status === 'editor-unavailable') {
          throw new Error('The destination note is not ready for insertion.');
        }
      }
    };
  }

  async function conversationIdForProjection(notePath: string | null) {
    if (!notePath) return null;
    const normalized = notePath.replaceAll('\\', '/');
    const conversations = await chatApi.listConversations(true);
    for (const summary of conversations) {
      const conversation = await chatApi.getConversation(summary.id);
      const projection = conversation.projectionPath?.replaceAll('\\', '/');
      if (!projection) continue;
      const directory = projection.replace(/\/Conversation\.md$/i, '');
      if (normalized === projection || normalized.endsWith(`/${projection}`) || normalized.includes(`/${directory}/`)) {
        return conversation.id;
      }
    }
    return null;
  }

  async function openChatProjection(
    paneId: PaneId,
    notePath: string | null,
    targetAnchor: string | null = null
  ) {
    const conversationId = await conversationIdForProjection(notePath);
    if (!conversationId) return false;
    touchPaneLocationForHistory(paneId);
    setStoredPaneKind(notepadState, paneId, 'chat');
    setPaneChatConversationId(notepadState, paneId, conversationId);
    // Record chat into the session MRU after kind flips so Recent keeps the slot.
    touchPaneLocationForHistory(paneId);
    chatTargetAnchors[paneId] = targetAnchor;
    workspaceStore.setActivePaneId(paneId);
    await getChatController(paneId).initialize(conversationId);
    return true;
  }

  async function discussSelection(sourcePaneId: PaneId, selectedText: string) {
    const text = selectedText.trim();
    if (!text || discussionInProgress) return;
    discussionInProgress = true;

    try {
      const order = [...workspaceStore.paneOrder];
      let chatPaneId = order.find((paneId) => getPaneKind(paneId) === 'chat') ?? null;
      let openedNewChatSurface = false;
      let createdSplitPane = false;

      if (!chatPaneId && order.length < MAX_VISIBLE_PANES) {
        const previousPaneIds = new Set(order);
        await commands.splitWorkspace();
        chatPaneId = workspaceStore.paneOrder.find((paneId) => !previousPaneIds.has(paneId)) ?? null;
        openedNewChatSurface = Boolean(chatPaneId);
        createdSplitPane = Boolean(chatPaneId);
      }

      if (!chatPaneId) {
        chatPaneId = order.find((paneId) => paneId !== sourcePaneId) ?? null;
        openedNewChatSurface = Boolean(chatPaneId && getPaneKind(chatPaneId) !== 'chat');
      }

      if (!chatPaneId) return;

      const controller = getChatController(chatPaneId);
      let conversation = controller.getSnapshot().conversation;

      if (openedNewChatSurface) {
        await controller.initialize();
        const label = text.replace(/\s+/g, ' ').slice(0, 48);
        conversation = await controller.createConversation({
          title: label ? `About: ${label}` : 'Selection discussion'
        });
      } else {
        const conversationId = getPaneState(notepadState, chatPaneId).chatConversationId;
        if (!conversation || (conversationId && conversation.id !== conversationId)) {
          await controller.initialize(conversationId);
          conversation = controller.getSnapshot().conversation;
        }
        if (!conversation) {
          conversation = await controller.createConversation({ title: 'Selection discussion' });
        }
      }

      if (conversation) {
        setPaneChatConversationId(notepadState, chatPaneId, conversation.id);
      }

      const sourceDocument = getPaneDocumentSession(sourcePaneId);
      discussionSeedCounter += 1;
      chatDraftSeeds[chatPaneId] = {
        id: `${Date.now()}-${discussionSeedCounter}`,
        text: formatDiscussionDraft(text, sourceDocument.title)
      };

      if (createdSplitPane) {
        await commands.resolvePaneCommandChoice(chatPaneId, 'thoughtPartner');
      } else if (getPaneKind(chatPaneId) !== 'chat') {
        await commands.setPaneKind(chatPaneId, 'chat');
      } else {
        workspaceStore.setActivePaneId(chatPaneId);
      }
      await tick();
    } finally {
      discussionInProgress = false;
    }
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

  function getPaneChatComposer(paneId: PaneId) {
    return (
      getPaneRuntime(paneId).refs.paneCard?.querySelector<HTMLTextAreaElement>(
        '.chat-pane-shell textarea'
      ) ?? null
    );
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
    closeSelectionMenu(paneId);
  }

  function applySelectionMenuSnapshotForPane(
    paneId: PaneId,
    snapshot: SelectionMenuSnapshot,
    view: import('@codemirror/view').EditorView
  ) {
    if (!snapshot.open) {
      getPaneRuntime(paneId).setSelectionMenu({ open: false });
      if (activeSelectionMenuPaneId === paneId) {
        activeSelectionMenuPaneId = null;
      }
      return;
    }
    if (paneId !== workspaceStore.activePaneId) {
      selectionMenuHideFromUi(view);
      getPaneRuntime(paneId).setSelectionMenu({ open: false });
      return;
    }
    for (const visiblePaneId of getVisiblePaneIds()) {
      if (visiblePaneId !== paneId) {
        closeSelectionMenu(visiblePaneId);
      }
    }
    closeWikilinkAutocomplete();
    closeSlashMenu(paneId);
    activeSelectionMenuPaneId = paneId;
    getPaneRuntime(paneId).setSelectionMenu({
      open: true,
      view,
      selectionFrom: snapshot.selectionFrom,
      selectionTo: snapshot.selectionTo,
      groups: snapshot.groups,
      hoverIndex: snapshot.hoverIndex,
      blockPanelOpen: snapshot.blockPanelOpen,
      activeInlineFormats: snapshot.activeInlineFormats
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

    const suppressAutosave = shouldSuppressAutosaveForDocument(document);
    if (!suppressAutosave && nextMarkdown.trim() !== '') {
      setRecentlyForgotten(null);
    }

    if (!suppressAutosave) {
      scheduleAutosave(document);
    }
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
    closeEditorTransientUi: (paneId) => {
      closeSlashMenu(paneId);
      closeSelectionMenu(paneId);
      closeWikilinkAutocomplete(paneId);
    },
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
    isTitleEditing: isTitleInputFocusedForNote,
    shouldSuppressPersistence: (note) => shouldSuppressAutosaveForDocument(note)
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
    registerPaneEditorForDocument: (paneId, document) => {
      documents.registerPaneEditorForDocument(paneId, document);
      presentProposalReview(document);
    },
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
    openRecentTaskByIndex,
    handleSearchInput,
    handleSearchModeChange,
    handleSearchOpen
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
    mode: SearchMode = currentSearchHighlightMode,
    options = { matchCase: searchState.matchCase, matchWholeWord: searchState.matchWholeWord }
  ) {
    for (const paneId of getEditorPaneIds()) {
      setEditorCurrentSearchHighlightQuery(getPaneRuntime(paneId).controller, null);
    }

    const trimmedQuery = query.trim();
    if (mode !== 'current' || trimmedQuery === '' || trimmedQuery.startsWith('/')) {
      return;
    }

    for (const paneId of getPaneIdsForDocument(getDocumentSession())) {
      setEditorCurrentSearchHighlightQuery(getPaneRuntime(paneId).controller, {
        query: trimmedQuery,
        ...options
      });
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
      closeSelectionMenu();
      for (const visiblePaneId of getVisiblePaneIds()) {
        if (visiblePaneId !== paneId) {
          getPaneControllers(visiblePaneId).wikilinkController.closeWikilinkAutocomplete();
        }
      }
    }
    getPaneRuntime(paneId).setWikilinkAutocomplete(nextState);
    activeWikilinkPaneId = nextState.active ? paneId : activeWikilinkPaneId === paneId ? null : activeWikilinkPaneId;
  }

  function closeSelectionMenu(paneId: PaneId | null = null) {
    const paneIds = paneId ? [paneId] : getVisiblePaneIds();
    for (const visiblePaneId of paneIds) {
      const controller = getPaneRuntime(visiblePaneId).controller;
      if (controller) {
        selectionMenuHideFromUi(controller.view);
      }
      getPaneRuntime(visiblePaneId).setSelectionMenu({ open: false });
    }
    if (paneId === null || activeSelectionMenuPaneId === paneId) {
      activeSelectionMenuPaneId = null;
    }
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
      closeSelectionMenu(visiblePaneId);
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
    if (rawTarget.replaceAll('\\', '/').startsWith('Chats/')) {
      const path = rawTarget.split('#', 1)[0];
      if (await openChatProjection(paneId, path.endsWith('.md') ? path : `${path}.md`)) return;
    }
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
    proposalOrchestrationInstance?.suspendDocument(
      document,
      editorCapabilities.get(paneId) ?? null
    );
    if (hasPendingDocumentSync(document)) {
      flushDocumentEditorSync(document);
    }
    documents.flushPaneCursorSave(paneId);
    documents.saveSharedEditorStateForDocument(document, null, paneId);
    flushPendingAutosave(document);
    await getNoteSaveQueue(document.key);
    closeWikilinkAutocomplete(paneId);
    getPaneRuntime(paneId).setSlashMenu({ open: false });
    getPaneRuntime(paneId).setSelectionMenu({ open: false });
    if (activeSlashMenuPaneId === paneId) {
      activeSlashMenuPaneId = null;
    }
    if (activeSelectionMenuPaneId === paneId) {
      activeSelectionMenuPaneId = null;
    }
    documents.unregisterPaneEditorForDocument(paneId, document);
    getPaneControllers(paneId).editorLifecycleController.dispose();
    await paneLifecycle.destroyPaneEditor(paneId);
    runtime.dispose();
    delete paneControllers[paneId];
    editorCapabilities.delete(paneId);
    chatControllers.get(paneId)?.dispose();
    chatControllers.delete(paneId);
    delete chatDraftSeeds[paneId];
    delete chatTargetAnchors[paneId];
    delete paneRuntimes[paneId];
  }

  // ---------------------------------------------------------------------------
  // High-level commands (open / forget / unforget / remember / split / close /
  // setKind / pane-command / switch-pane). Encapsulated in notepadCommands so
  // the component does not own every flow body.
  // ---------------------------------------------------------------------------
  const notepadWorkspaceCommands = createNotepadWorkspaceCommands<PaneId>(workspaceStore, {
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
    getPaneChatComposer,
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
    getRecentNotesForSeed: () => searchState.recentNotes,
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
    forgottenNoteRetentionPreference: () => $forgottenNoteRetentionPreference,
    canLeaveDocument: () => true,
    onDocumentLeaving: (document) => {
      proposalOrchestrationInstance?.suspendDocument(
        document,
        editorCapabilities.get(getNavigationPaneId()) ?? null
      );
    },
    onDocumentOpened: (document) => {
      proposalOrchestrationInstance?.restoreDocument(document);
    },
    onDocumentPresented: (document) => {
      presentProposalReview(document);
    }
  });
  touchPaneLocationForHistory = commands.touchCurrentLocation;
  commands.setLocationHistoryEpochListener((epoch) => {
    locationHistoryEpoch = epoch;
  });

  let paneCommandPreviousNoteLabel = $derived.by(() => {
    void locationHistoryEpoch;
    if (paneCommandPaneId === null) {
      return null;
    }
    return commands.paneCommandPreviousLocationLabel(paneCommandPaneId);
  });
  let paneCommandPreviousNoteShortcutLabel = $derived(
    formatShortcutBinding($keyboardShortcutBindings.goToPreviousNote)
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

  function getNearestEditorPaneId(fromPaneId: PaneId | null = activePaneId): PaneId | null {
    const order = paneOrder;
    if (fromPaneId && getPaneKind(fromPaneId) === 'editor') return fromPaneId;
    return (
      order.find((paneId) => getPaneKind(paneId) === 'editor') ?? null
    );
  }

  /** Prefer an editor that already has a saved note; skip pathless split placeholders. */
  function getEditorPaneDocumentForReview() {
    const editorPaneIds = paneOrder.filter((paneId) => getPaneKind(paneId) === 'editor');
    for (const paneId of editorPaneIds) {
      const document = getPaneDocumentSession(paneId);
      if (document.currentNotePath) return document;
    }
    if (editorPaneIds[0]) return getPaneDocumentSession(editorPaneIds[0]);
    const chatPaneId = paneOrder.find((id) => getPaneKind(id) === 'chat');
    return chatPaneId ? getPaneDocumentSession(chatPaneId) : null;
  }

  const proposalOrchestration = createProposalOrchestration({
    getEditorPaneDocument: () => getEditorPaneDocumentForReview(),
    getChatContextNote: () => {
      const chatPaneId =
        (activePaneId && getPaneKind(activePaneId) === 'chat' ? activePaneId : null) ??
        paneOrder.find((id) => getPaneKind(id) === 'chat') ??
        getNearestEditorPaneId();
      if (!chatPaneId) return null;
      const document = getPaneDocumentSession(chatPaneId);
      if (!document.currentNotePath) {
        // Fall back to any open note when chat isn't bound yet.
        const fallback = getEditorPaneDocumentForReview();
        if (!fallback?.currentNotePath) return null;
        return {
          path: fallback.currentNotePath,
          title: fallback.title,
          lastSavedMarkdown: fallback.lastSavedMarkdown
        };
      }
      return {
        path: document.currentNotePath,
        title: document.title,
        lastSavedMarkdown: document.lastSavedMarkdown
      };
    },
    getEditorForDocument: (document) => {
      const paneId = getPaneIdsForDocument(document).find(
        (id) => getPaneKind(id) === 'editor'
      );
      if (!paneId) return null;
      const editor = editorCapabilities.get(paneId) ?? null;
      // Adapter exists before the CM controller mounts — treat as missing until live.
      if (!editor?.isReady()) return null;
      return editor;
    },
    getEditorsForDocument: (document) =>
      getPaneIdsForDocument(document)
        .filter((id) => getPaneKind(id) === 'editor')
        .map((id) => editorCapabilities.get(id) ?? null)
        .filter((editor): editor is NonNullable<typeof editor> => Boolean(editor?.isReady())),
    flushBeforePreview: async (document) => {
      flushDocumentEditorSync(document);
      cancelPendingAutosave(document);
      await enqueueSave(document);
      await getNoteSaveQueue(document.key);
    },
    ensureEditorPaneForReview: async () => {
      let editorPaneId = getNearestEditorPaneId();

      if (!editorPaneId) {
        // Chat-only (or no editor pane). Prefer chat | editor with the bound note.
        if (paneOrder.length === 1 && window.innerWidth >= 640) {
          await splitWorkspaceIfAllowed('current');
          editorPaneId = getNearestEditorPaneId();
        } else {
          const chatPaneId =
            (activePaneId && getPaneKind(activePaneId) === 'chat' ? activePaneId : null) ??
            paneOrder.find((id) => getPaneKind(id) === 'chat') ??
            null;
          if (chatPaneId) {
            await commands.setPaneKind(chatPaneId, 'editor');
            editorPaneId = chatPaneId;
          }
        }
      }

      // Keep the proposal list visible: if we only have an editor, open chat beside it.
      if (
        paneOrder.length === 1 &&
        editorPaneId &&
        getPaneKind(editorPaneId) === 'editor' &&
        window.innerWidth >= 640
      ) {
        await splitWorkspaceIfAllowed('thoughtPartner');
        editorPaneId = getNearestEditorPaneId() ?? editorPaneId;
      }

      // Split can leave a pathless placeholder editor — bind the chat/context note.
      if (editorPaneId && !getPaneDocumentSession(editorPaneId).currentNotePath) {
        const source =
          paneOrder
            .map((id) => getPaneDocumentSession(id))
            .find((doc) => doc.currentNotePath) ?? null;
        if (source) {
          setPaneDocumentSession(editorPaneId, source);
          flushDocumentEditorSync(source);
        }
      }

      await tick();
      await paneLifecycle.ensurePaneEditors();
    },
    activateEditorPane: async () => {
      // Prefer the editor that already hosts a saved note.
      const withPath = paneOrder.find(
        (id) =>
          getPaneKind(id) === 'editor' &&
          Boolean(getPaneDocumentSession(id).currentNotePath)
      );
      const editorPaneId = withPath ?? getNearestEditorPaneId();
      if (editorPaneId) {
        commands.activatePane(editorPaneId);
        await tick();
        await paneLifecycle.ensurePaneEditors();
      }
    },
    cancelPendingAutosave: (document) => {
      cancelPendingAutosave(document);
    },
    scheduleAutosave: (document) => scheduleAutosave(document),
    reloadReviewFromDisk: async () => {
      await commands.refreshCurrentNoteIfChanged();
    },
    reopenReviewEditor: async (document) => {
      let paneId = getPaneIdsForDocument(document).find((id) => getPaneKind(id) === 'editor') ?? null;
      if (!paneId && paneOrder.length < MAX_VISIBLE_PANES) {
        await splitWorkspaceIfAllowed('current');
        paneId = getNearestEditorPaneId();
      }
      if (!paneId) {
        // A compact/chat-only workspace has no spare pane; reuse the active
        // pane only when the user explicitly asks to reopen the review.
        paneId = activePaneId;
        await commands.setPaneKind(paneId, 'editor');
      }
      setPaneDocumentSession(paneId, document);
      await tick();
      await paneLifecycle.ensurePaneEditors();
      const editor = editorCapabilities.get(paneId) ?? null;
      return editor?.isReady() ? editor : null;
    },
    refreshDocumentAfterKeep: async () => {
      // The reviewed editor already holds the committed body. Refresh it in
      // place so the adjacent chat pane remains a chat pane.
      await commands.refreshCurrentNoteIfChanged();
    }
  });
  proposalOrchestrationInstance = proposalOrchestration;

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
    noteKeyFromPath,
    shouldDeferRefresh: (notePath) => {
      if (!proposalOrchestration.isReviewingPath(notePath)) return false;
      proposalOrchestration.markConflict(notePath);
      return true;
    }
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
    if (result.documentKind && result.documentKind !== 'note') {
      if (await openChatProjection(getNavigationPaneId(), result.notePath, result.blockAnchor ?? null)) {
        clearSearch();
        return;
      }
    }
    workspaceStore.resetPaneCommand();
    if (searchState.searchMode === 'current' && result.currentMatchRange) {
      searchState.clearSearch();
      const paneId = getNavigationPaneId();
      activatePaneSession(paneId);
      await tick();
      focusEditorSearchRange(getPaneRuntime(paneId).controller, result.currentMatchRange);
      documents.saveCursorPositionForDocument();
      return;
    }

    await openSearchResult(getOpenContext(), getNavigationContext(), result);
    documents.saveCursorPositionForDocument();
  }

  async function handleSearchResultNavigate(result: SearchItem) {
    if (searchState.searchMode !== 'current' || !result.currentMatchRange) {
      return;
    }

    workspaceStore.resetPaneCommand();
    const paneId = getNavigationPaneId();
    activatePaneSession(paneId);
    await tick();
    focusEditorSearchRange(getPaneRuntime(paneId).controller, result.currentMatchRange);
    documents.saveCursorPositionForDocument();
  }

  async function handleRecentTaskSelect(task: RecentTaskItem) {
    workspaceStore.resetPaneCommand();
    await openRecentTask(getOpenContext(), getNavigationContext(), task);
    documents.saveCursorPositionForDocument();
  }

  async function handleRelatedItemSelect(item: RelatedNoteItem) {
    if (item.documentKind && item.documentKind !== 'note') {
      if (await openChatProjection(getNavigationPaneId(), item.notePath, item.blockAnchor ?? null)) return;
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
      reasonLabels: ['related'],
      lexicalScore: null,
      semanticScore: item.score,
      startLine: item.startLine,
      endLine: item.endLine,
      blockAnchor: item.blockAnchor ?? null
    });
    documents.saveCursorPositionForDocument();
  }

  async function splitWorkspaceIfAllowed(choice: PaneCommandChoice | undefined = undefined) {
    if (window.innerWidth < 640) {
      return;
    }

    await commands.splitWorkspace();

    if (choice) {
      const targetPaneId = workspaceStore.paneCommand.paneId;
      // If there is no previous location, preserve the picker so it can explain the
      // unavailable option instead of silently resolving to a blank pane.
      const hasPrevious =
        targetPaneId !== null &&
        (await commands.resolvePreviousLocationForPaneCommand(targetPaneId as PaneId)) !== null;
      if (targetPaneId && (choice !== 'previous' || hasPrevious)) {
        await commands.resolvePaneCommandChoice(targetPaneId as PaneId, choice);
      }
    }
  }

  async function openPaneChoiceInCurrent(choice: PaneCommandChoice) {
    if (choice === 'current') {
      await commands.setPaneKind(activePaneId, 'editor');
      return;
    }
    if (choice === 'thoughtPartner') {
      await commands.setPaneKind(activePaneId, 'chat');
      return;
    }

    if (choice === 'previous') {
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
    splitWorkspace: () => splitWorkspaceIfAllowed(),
    closePane: commands.closePane,
    switchActivePane: commands.switchActivePane,
    startNewNoteFlow: commands.startNewNoteFlow,
    toggleRelatedPanel,
    goToPreviousLocation: commands.goToPreviousLocation,
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
    const nearestEditorPaneId = paneKind === 'chat'
      ? paneOrder
          .filter((candidate) => getPaneKind(candidate) === 'editor')
          .sort((left, right) => Math.abs(paneOrder.indexOf(left) - paneIndex) - Math.abs(paneOrder.indexOf(right) - paneIndex))[0]
      : null;
    const chatContextDocument = nearestEditorPaneId
      ? getPaneDocumentSession(nearestEditorPaneId)
      : paneDocument;

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
      titleValue: paneKind === 'editor' ? paneDocument.title : 'Thought partner',
      titleReadonly:
        paneKind === 'chat' || proposalOrchestration.isReviewingDocument(paneDocument),
      chatController: paneKind === 'chat' ? getChatController(paneId) : null,
      chatConversationId: getPaneState(notepadState, paneId).chatConversationId,
      chatDraftSeed: chatDraftSeeds[paneId] ?? null,
      chatContextNote: paneKind === 'chat' && (chatContextDocument.currentNotePath || chatContextDocument.title.trim())
        ? {
            noteId: chatContextDocument.currentNoteId,
            notePath: chatContextDocument.currentNotePath,
            noteTitle: chatContextDocument.title.trim()
              || chatContextDocument.currentNotePath?.split('/').at(-1)?.replace(/\.md$/i, '')
              || 'Untitled note'
          }
        : null,
      chatTargetAnchor: chatTargetAnchors[paneId] ?? null,
      chatSelectionActions: chatSelectionActions(),
      onChatConversationChange: (conversationId) => {
        setPaneChatConversationId(notepadState, paneId, conversationId);
        if (getPaneKind(paneId) === 'chat') {
          touchPaneLocationForHistory(paneId);
        }
      },
      proposalSnapshot: proposalOrchestration.session.snapshot,
      proposalPendingCount: proposalOrchestration.session.pendingCount,
      onProposalOpenChange: (change) => void proposalOrchestration.showChange(change),
      onProposalKeep: (changeId) => void proposalOrchestration.keep(changeId),
      onProposalUndo: (changeId) => void proposalOrchestration.undo(changeId),
      onProposalKeepAll: () => void proposalOrchestration.keepAll(),
      onProposalUndoAll: () => void proposalOrchestration.undoAll(),
      onProposalReview: () => void proposalOrchestration.reviewNext(),
      onProposalRetry: () => void proposalOrchestration.retryCommit(),
      onProposalCopyCurrent: () => void proposalOrchestration.copyCurrent(),
      onProposalReloadDisk: () => void proposalOrchestration.reloadDisk(),
      onProposalLoadFixture: () => void proposalOrchestration.loadFixture(),
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
    onOpenPaneChoice: openPaneChoiceInCurrent,
    // Same path as Cmd+L: restore the previous location from the pane MRU.
    onSwitchToEditor: (paneId) => commands.goToPreviousLocation(paneId),
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

    setSelectionMenuListener((view, snapshot) => {
      const paneKey = getPaneIdForSelectionMenuView(view);
      if (paneKey && paneKey in paneRuntimes) {
        applySelectionMenuSnapshotForPane(paneKey as PaneId, snapshot, view);
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
        const pendingNoteTarget = consumePendingNoteTarget();
        if (pendingNoteTarget) {
          if (
            pendingNoteTarget.documentKind &&
            pendingNoteTarget.documentKind !== 'note'
          ) {
            await openChatProjection(getNavigationPaneId(), pendingNoteTarget.notePath);
          } else {
            await commands.openNotePath(pendingNoteTarget.notePath, {
              noteId: pendingNoteTarget.noteId,
              focusEditorAfterOpen: true
            });
          }
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
      setSelectionMenuListener(null);
      mounted = false;
      flushAllPendingDocumentSyncs();
      documents.flushAllPendingCursorSaves();
      documents.saveCursorPositionForDocument();
      documents.saveSharedEditorStateForDocument();
      flushPendingAutosave();
      for (const paneId of getVisiblePaneIds()) {
        getPaneControllers(paneId).editorLifecycleController.dispose();
      }
      for (const controller of chatControllers.values()) controller.dispose();
      chatControllers.clear();
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
    class="relative h-full min-h-0 w-full [--related-reserved-width:0px]"
    style={getRelatedGroupStyle($relatedState.panelPlacement, $relatedState.reservedWidth)}
  >
  <div
    class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-y border-border text-card-foreground shadow-sm transition-[margin-left,width] duration-300 ease-out will-change-[margin-left,width] sm:rounded-4xl sm:border"
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

    <div class="absolute right-0 left-0 z-30 bottom-(--keyboard-inset-height) transition-[bottom] duration-180 ease-in-out">
      <NotepadCommandBar
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
              console.error('Failed to open searched note:', error);
            }),
          onSearchNavigate: (result) =>
            void handleSearchResultNavigate(result).catch((error) => {
              console.error('Failed to navigate search result:', error);
            }),
          onRecentLocationSelect: (entry) =>
            void commands.openLocationFromHistory(entry.location).catch((error) => {
              console.error('Failed to open recent location:', error);
            }),
          onRecentTaskSelect: (task) =>
            void handleRecentTaskSelect(task).catch((error) => {
              console.error('Failed to open recent task:', error);
            }),
          onRecentLocationShortcut: (index) => {
            const entry = locationHistoryItems[index];
            if (entry) {
              void commands.openLocationFromHistory(entry.location).catch((error) => {
                console.error('Failed to open recent location:', error);
              });
            }
          },
          onRecentTaskShortcut: (index) => void openRecentTaskByIndex(index),
          onSearchOpen: () => {
            handleSearchOpen();
            void refreshLocationHistory();
          },
          onCommand: (command) => commands.handleNotepadCommandBarCommand(command)
        }}
      />
  </div>
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
    --gn-code-keyword: color-mix(in oklab, var(--accent) 70%, var(--foreground) 30%);
    --gn-code-name: var(--foreground);
    --gn-code-property: color-mix(in oklab, var(--accent) 60%, var(--foreground) 40%);
    --gn-code-variable: var(--foreground);
    --gn-code-function: color-mix(in oklab, var(--accent) 80%, var(--foreground) 20%);
    --gn-code-constant: var(--destructive);
    --gn-code-type: color-mix(in oklab, var(--accent) 50%, var(--foreground) 50%);
    --gn-code-operator: color-mix(in oklab, var(--foreground) 60%, var(--accent) 40%);
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
</style>

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

  {#if activeSelectionMenuPaneId}
    {@const selectionPaneId = activeSelectionMenuPaneId}
    <SelectionMenu
      menu={getPaneRuntime(activeSelectionMenuPaneId).ui.selectionMenu}
      boundsElement={getPaneRuntime(activeSelectionMenuPaneId).refs.paneCard}
      onThoughtPartner={({ text }) => {
        void discussSelection(selectionPaneId, text).catch((error) => {
          console.error('Failed to discuss selection:', error);
        });
      }}
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
