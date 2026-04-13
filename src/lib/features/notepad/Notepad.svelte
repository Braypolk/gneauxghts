<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { Columns2, X } from 'lucide-svelte';
  import { onMount, tick } from 'svelte';
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
    readEditorState
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
    storePastedImageAsset,
    type ForgottenNote,
    type SaveMode,
    type SessionSnapshot
  } from '$lib/features/notepad/session/session';
  import {
    activateDocumentSession as activateSharedDocumentSession,
    createDocumentSessionStore,
    discardDocumentSession as discardSharedDocumentSession,
    getActivePaneSession,
    resetActiveDocumentSession as resetSharedActiveDocumentSession,
    syncActiveDocumentSession as syncSharedActiveDocumentSession,
    syncDocumentSession as syncSharedDocumentSession,
    type DocumentSession,
    DEFAULT_DOCUMENT_PANE_ID
  } from '$lib/features/notepad/session/documentSession';
  import {
    createWikilinkAutocompleteState,
    type WikilinkAutocompleteState
  } from '$lib/features/notepad/wikilinks/state';
  import type { RecentTaskItem } from '$lib/features/notepad/model/types';
  import BottomBar from '$lib/features/notepad/ui/BottomBar.svelte';
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
  import { createSearchController } from '$lib/features/notepad/search/controller';
  import { createRelatedController } from '$lib/features/notepad/related/controller';
  import { createSessionController } from '$lib/features/notepad/session/controller';
  import { findProseMirrorElement } from '$lib/features/notepad/editor/editorDom';
  import { createEditorLifecycleController } from '$lib/features/notepad/editor/editorLifecycleController';
  import {
    getPaneIdForSlashMenuView,
    setSlashMenuListener
  } from '$lib/features/notepad/editor/slashMenuBridge';
  import type { SlashMenuSnapshot } from '$lib/features/notepad/editor/slashMenu';
  import { createWikilinkController } from '$lib/features/notepad/wikilinks/controller';
  import {
    activeProposalSession,
    getProposalChangesForPath,
    toggleProposalChange,
    toggleProposalHunk,
    toggleProposalTitle
  } from '$lib/features/proposals/session';
  import { cancelScheduledAutoSync, runAutoSyncNow, scheduleAutoSync } from '$lib/sync/autoSync';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';

  type PaneId = typeof PRIMARY_PANE_ID | typeof SECONDARY_PANE_ID;
  type PaneKind = 'editor' | 'chat';

  interface PaneUiState {
    kind: PaneKind;
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

  const PRIMARY_PANE_ID = DEFAULT_DOCUMENT_PANE_ID;
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
      kind: 'editor',
      isEditorReady: false,
      isApplyingExternalContent: false,
      wikilinkAutocomplete: createWikilinkAutocompleteState(),
      editorGeneration: 0,
      slashMenu: { open: false }
    },
    [SECONDARY_PANE_ID]: {
      kind: 'editor',
      isEditorReady: false,
      isApplyingExternalContent: false,
      wikilinkAutocomplete: createWikilinkAutocompleteState(),
      editorGeneration: 0,
      slashMenu: { open: false }
    }
  });

  const documentSessionStore = createDocumentSessionStore();
  let documentSession = $state<DocumentSession>(documentSessionStore.activePane.document);
  const sharedEditorResourcesByDocument = new WeakMap<DocumentSession, ReturnType<typeof createSharedEditorResources>>();
  const cursorSaveTimers = new Map<PaneId, ReturnType<typeof window.setTimeout>>();
  const documentSyncFrameIds = new Map<DocumentSession, number>();

  let canUnforget = $state(false);
  let forgottenNote: ForgottenNote | null = null;
  let searchMode = $state<SearchMode>('all');
  let searchQuery = $state('');
  let searchResults = $state<SearchItem[]>([]);
  let recentNotes = $state<SearchItem[]>([]);
  let recentTasks = $state<RecentTaskItem[]>([]);
  let isSearching = $state(false);
  let searchFocusRequest = $state(0);
  let isRefreshingFromDisk = false;
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;
  let assetRootPath = $state<string | null>(null);
  let relatedItems = $state<RelatedNoteItem[]>([]);
  let relatedStatus = $state<RelatedNotesResponse['status']>('insufficientContent');
  let relatedReason = $state<string | null>(EMPTY_RELATED_REASON);
  let relatedScope = $state<'note' | 'selection'>('note');
  let relatedPanelPlacement = $state<'side' | 'bottom'>('side');
  let isLoadingRelated = $state(false);
  let selectedRelatedText = $state<string | null>(null);
  let isRelatedPanelCollapsed = $state(true);
  let relatedDrawerReservedWidth = $state(0);
  let semanticStatus = $state<SemanticStatus | null>(null);
  let proposalPreviewPath = $state<string | null>(null);
  let isSyncingProposalPreview = false;
  let proposalErrorMessage = $state('');

  function getPaneKind(paneId: PaneId) {
    return paneStates[paneId].kind;
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

  function setCurrentDocument(document: DocumentSession) {
    documentSession = document;
  }

  function ensurePaneSession(
    paneId: PaneId,
    document: DocumentSession = getDocumentSession()
  ) {
    let paneSession = documentSessionStore.panesById.get(paneId);
    if (!paneSession) {
      paneSession = { paneId, document };
      documentSessionStore.panesById.set(paneId, paneSession);
    }

    return paneSession;
  }

  function getPaneDocumentSession(paneId: PaneId) {
    return ensurePaneSession(paneId).document;
  }

  function setPaneDocumentSession(paneId: PaneId, document: DocumentSession) {
    const paneSession = ensurePaneSession(paneId, document);
    paneSession.document = document;
    if (documentSessionStore.activePaneId === paneId) {
      documentSessionStore.activePane = paneSession;
      setCurrentDocument(document);
    }
    return paneSession;
  }

  function activatePaneSession(paneId: PaneId) {
    const paneSession = ensurePaneSession(paneId);
    documentSessionStore.activePaneId = paneId;
    documentSessionStore.activePane = paneSession;
    activePaneId = paneId;
    setCurrentDocument(paneSession.document);
    return paneSession;
  }

  function getPaneIdsForDocument(document: DocumentSession) {
    return getVisiblePaneIds().filter(
      (paneId) => getPaneKind(paneId) === 'editor' && getPaneDocumentSession(paneId) === document
    );
  }

  function activateDocumentSession(snapshot: SessionSnapshot) {
    activateSharedDocumentSession(documentSessionStore, snapshot);
    setCurrentDocument(getActivePaneSession(documentSessionStore).document);
    return documentSession;
  }

  function syncActiveDocumentSession(snapshot: SessionSnapshot) {
    syncSharedActiveDocumentSession(documentSessionStore, snapshot);
    setCurrentDocument(getActivePaneSession(documentSessionStore).document);
    return documentSession;
  }

  function syncDocumentSession(
    document: DocumentSession,
    snapshot: SessionSnapshot,
    options?: { preserveDraft?: boolean }
  ) {
    syncSharedDocumentSession(documentSessionStore, document, snapshot, options);
    setCurrentDocument(getActivePaneSession(documentSessionStore).document);
    return document;
  }

  function resetActiveDocumentSession() {
    resetSharedActiveDocumentSession(documentSessionStore);
    setCurrentDocument(getActivePaneSession(documentSessionStore).document);
    return documentSession;
  }

  function discardDocumentSession(noteId: string | null, notePath: string | null) {
    discardSharedDocumentSession(documentSessionStore, noteId, notePath);
  }

  function getCurrentMarkdown() {
    return documentSession.bodyMarkdown;
  }

  function getSharedEditorStateForDocument(document: DocumentSession) {
    return document.sharedEditorState;
  }

  function setSharedEditorStateForDocument(
    document: DocumentSession,
    editorState: EditorState | null
  ) {
    document.sharedEditorState = editorState;
  }

  function getSharedEditorResources(document: DocumentSession) {
    let resources = sharedEditorResourcesByDocument.get(document);
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
    sharedEditorResourcesByDocument.set(document, resources);
    return resources;
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
    document: DocumentSession = getPaneDocumentSession(paneId)
  ) {
    paneStates[paneId].editorGeneration = document.sharedEditorStateGeneration;
  }

  function flushDocumentEditorSync(document: DocumentSession) {
    const frameId = documentSyncFrameIds.get(document);
    if (frameId !== undefined) {
      window.cancelAnimationFrame(frameId);
      documentSyncFrameIds.delete(document);
    }

    const sharedEditorState = getSharedEditorStateForDocument(document);
    if (!sharedEditorState) {
      return;
    }

    for (const paneId of getPaneIdsForDocument(document)) {
      if (paneStates[paneId].editorGeneration >= document.sharedEditorStateGeneration) {
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

  function scheduleDocumentEditorSync(document: DocumentSession) {
    if (documentSyncFrameIds.has(document)) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      documentSyncFrameIds.delete(document);
      flushDocumentEditorSync(document);
    });
    documentSyncFrameIds.set(document, frameId);
  }

  function flushAllPendingDocumentSyncs() {
    const documents = new Set<DocumentSession>([
      ...documentSyncFrameIds.keys(),
      documentSessionStore.activePane.document,
      ...documentSessionStore.documentsByKey.values(),
      ...[...documentSessionStore.panesById.values()].map((paneSession) => paneSession.document)
    ]);

    for (const document of documents) {
      flushDocumentEditorSync(document);
    }
  }

  function saveCursorPositionForDocument(document: DocumentSession = getDocumentSession()) {
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
    document: DocumentSession = getDocumentSession(),
    editorState: EditorState | null = null,
    preferredPaneId: PaneId = getNavigationPaneId()
  ) {
    const paneIds = getPaneIdsForDocument(document);
    const paneId =
      (paneIds.includes(preferredPaneId) ? preferredPaneId : paneIds[0]) ?? null;
    if (!paneId) {
      if (!document.sharedEditorState && editorState) {
        setSharedEditorStateForDocument(document, editorState);
      }
      return;
    }

    if (
      document.sharedEditorState &&
      paneStates[paneId].editorGeneration < document.sharedEditorStateGeneration
    ) {
      return;
    }

    paneControllers[paneId].editorLifecycleController.saveSharedEditorStateForDocument(
      document,
      editorState
    );
  }

  function discardSharedEditorStateForDocument(document: DocumentSession) {
    setSharedEditorStateForDocument(document, null);
    document.sharedEditorStateGeneration = 0;
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
    document: DocumentSession
  ) {
    for (const paneId of getPaneIdsForDocument(document)) {
      await paneControllers[paneId].editorLifecycleController.replaceEditorContentInPlaceForDocument(
        nextMarkdown,
        document
      );
    }
  }

  async function restoreSharedEditorStateForDocument(document: DocumentSession) {
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
    document: DocumentSession,
    nextMarkdown: string,
    editorState: EditorState | null
  ) {
    const resolvedPaneId = paneId as PaneId;
    if (editorState) {
      setSharedEditorStateForDocument(document, editorState);
      document.sharedEditorStateGeneration += 1;
      markPaneDocumentGeneration(resolvedPaneId, document);
    }

    document.bodyMarkdown = nextMarkdown;
    if (
      getPaneIdsForDocument(document).some((paneId) => paneStates[paneId].isApplyingExternalContent) ||
      isDocumentUnderProposal(document)
    ) {
      return;
    }

    if (nextMarkdown.trim() !== '') {
      canUnforget = false;
    }

    if (getPaneIdsForDocument(document).length > 1) {
      scheduleDocumentEditorSync(document);
    }

    scheduleAutosave();
    scheduleSearch();
    scheduleRelated();
  }

  function handleTitleInput(paneId: PaneId, event: Event) {
    activatePaneSession(paneId);
    const paneDocument = getPaneDocumentSession(paneId);
    if (isDocumentUnderProposal(paneDocument)) {
      return;
    }

    paneDocument.title = (event.currentTarget as HTMLInputElement).value;
    if (paneDocument.title.trim() !== '' || paneDocument.bodyMarkdown.trim() !== '') {
      canUnforget = false;
    }
    scheduleAutosave();
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

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (handleWikilinkKeydown(event)) {
      return;
    }

    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'r'
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
      event.key.toLowerCase() === 'l'
    ) {
      event.preventDefault();
      void openRecentNoteByIndex(0, { forceReload: true });
      return;
    }

    if (!event.metaKey || event.key.toLowerCase() !== 'f') return;

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
    if (searchQuery.trim() !== '') {
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
      discardDocumentSession(null, payload.notePath);
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

  const searchController = createSearchController({
    getCurrentTitle: () => documentSession.title,
    getCurrentMarkdown,
    getCurrentPath: () => documentSession.currentNotePath,
    getSearchMode: () => searchMode,
    setSearchMode: (mode) => {
      searchMode = mode;
    },
    getSearchQuery: () => searchQuery,
    setSearchQuery: (query) => {
      searchQuery = query;
    },
    setSearchResults: (results) => {
      searchResults = results;
    },
    getRecentNotes: () => recentNotes,
    setRecentNotes: (notes) => {
      recentNotes = notes;
    },
    getRecentTasks: () => recentTasks,
    setRecentTasks: (tasks) => {
      recentTasks = tasks;
    },
    setIsSearching: (value) => {
      isSearching = value;
    },
    bumpSearchFocusRequest: () => {
      searchFocusRequest += 1;
    },
    openSearchResult: handleSearchResultSelect,
    openRecentTask: handleRecentTaskSelect,
    openNote: async (noteId, notePath) => openNotePath(notePath, { noteId })
  });

  const relatedController = createRelatedController({
    getCurrentTitle: () => documentSession.title,
    getCurrentMarkdown,
    getCurrentPath: () => documentSession.currentNotePath,
    getScope: () => relatedScope,
    setScope: (scope) => {
      relatedScope = scope;
    },
    getSelectedText: () => selectedRelatedText,
    setSelectedText: (value) => {
      selectedRelatedText = value;
    },
    isPanelCollapsed: () => isRelatedPanelCollapsed,
    setPanelCollapsed: (value) => {
      isRelatedPanelCollapsed = value;
    },
    setPanelLayout: (placement, reservedWidth) => {
      relatedPanelPlacement = placement;
      relatedDrawerReservedWidth = reservedWidth;
    },
    setItems: (items) => {
      relatedItems = items;
    },
    setStatus: (status) => {
      relatedStatus = status;
    },
    setReason: (reason) => {
      relatedReason = reason;
    },
    setIsLoading: (value) => {
      isLoadingRelated = value;
    }
  });

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
  } = searchController;

  const {
    updateDrawerLayout: updateRelatedDrawerLayoutController,
    clearSelectedRelatedText: clearSelectedRelatedTextController,
    scheduleRelated,
    handleRelatedScopeChange,
    toggleRelatedPanel: toggleRelatedPanelController,
    updateSelectedRelatedText: updateSelectedRelatedTextController
  } = relatedController;

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

    const wikilinkController = createWikilinkController({
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

  const sessionController = createSessionController({
    getDocumentSession,
    activateDocumentSession,
    syncActiveDocumentSession,
    syncDocumentSession,
    resetActiveDocumentSession,
    discardDocumentSession,
    isEditorReady: () =>
      getPaneIdsForDocument(getDocumentSession()).some((paneId) => paneStates[paneId].isEditorReady),
    getIsRefreshingFromDisk: () => isRefreshingFromDisk,
    setIsRefreshingFromDisk: (value) => {
      isRefreshingFromDisk = value;
    },
    getForgottenNote: () => forgottenNote,
    setForgottenNote: (value) => {
      forgottenNote = value;
    },
    setCanUnforget: (value) => {
      canUnforget = value;
    },
    getForgottenRetentionDays: () => $forgottenNoteRetentionPreference,
    saveCursorPositionForDocument,
    saveSharedEditorStateForDocument,
    discardSharedEditorStateForDocument,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replaceEditorContentInPlaceForDocument,
    restoreSharedEditorStateForDocument,
    clearSelectedRelatedText,
    clearSearch,
    scheduleSearch,
    scheduleRelated,
    loadRecentNotes,
    scheduleAutoSync,
    closeWikilinkAutocomplete,
    setAssetRootPath: (value) => {
      assetRootPath = value;
    }
  });

  function scheduleAutosave() {
    sessionController.scheduleAutosave();
  }

  function cancelPendingAutosave() {
    sessionController.cancelPendingAutosave();
  }

  async function enqueueSave(mode: SaveMode) {
    return sessionController.enqueueSave(mode);
  }

  function flushPendingAutosave() {
    sessionController.flushPendingAutosave();
  }

  async function clearNotepad(options: { canRestore?: boolean } = {}) {
    flushAllPendingDocumentSyncs();
    flushAllPendingCursorSaves();
    await sessionController.clearNotepad(options);
  }

  async function unforgetNotepad() {
    flushAllPendingDocumentSyncs();
    flushAllPendingCursorSaves();
    await sessionController.unforgetNotepad();
  }

  async function loadSavedNote() {
    await sessionController.loadSavedNote();
  }

  async function loadAssetRoot() {
    await sessionController.loadAssetRoot();
  }

  async function refreshCurrentNoteIfChanged() {
    flushAllPendingDocumentSyncs();
    flushAllPendingCursorSaves();
    await sessionController.refreshCurrentNoteIfChanged();
  }

  function resolveRememberAction(actionId: string): RememberActionOption {
    return $rememberActionOptions.find((option) => option.id === actionId) ?? EXACT_REMEMBER_ACTION;
  }

  async function rememberCurrentNote(action: RememberActionOption) {
    flushAllPendingDocumentSyncs();
    flushAllPendingCursorSaves();
    const resolvedAction =
      rememberActionRequiresIntegrateSupport(action) && !canIntegrate()
        ? resolveRememberAction('exact')
        : action;
    await sessionController.rememberCurrentNote(
      resolvedAction,
      $cleanUpApplyPolicyPreference
    );
  }

  async function openNotePath(
    notePath: string | null,
    options: { noteId?: string | null; currentNoteAlreadySaved?: boolean } = {}
  ) {
    flushAllPendingDocumentSyncs();
    flushAllPendingCursorSaves();
    const paneId = activePaneId;
    const previousDocument = getPaneDocumentSession(paneId);
    await sessionController.openNotePath(options.noteId ?? null, notePath, {
      currentNoteAlreadySaved: options.currentNoteAlreadySaved ?? hasCurrentProposalReview
    });

    const nextDocument = getPaneDocumentSession(paneId);
    if (
      paneStates[paneId].kind === 'editor' &&
      previousDocument !== nextDocument &&
      getPaneController(paneId)
    ) {
      await paneControllers[paneId].editorLifecycleController.replaceEditorContent(
        nextDocument.bodyMarkdown,
        {
          restoreCursor: true
        }
      );
      markPaneDocumentGeneration(paneId, nextDocument);
    }
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

  function getProposalChangesForDocument(document: DocumentSession) {
    return getProposalChangesForPath($activeProposalSession, document.currentNotePath);
  }

  function isDocumentUnderProposal(document: DocumentSession) {
    return getProposalChangesForDocument(document).length > 0;
  }

  async function syncProposalPreviewToEditor() {
    if (isSyncingProposalPreview) {
      return;
    }

    const notePath = documentSession.currentNotePath;
    if (!notePath) {
      proposalPreviewPath = null;
      return;
    }

    isSyncingProposalPreview = true;
    try {
      if (!hasCurrentProposalReview) {
        if (proposalPreviewPath === notePath) {
          documentSession.title = documentSession.lastSavedTitle;
        }
        proposalPreviewPath = null;
        return;
      }

      if (!currentProposalPreview) {
        documentSession.title = documentSession.lastSavedTitle;
        proposalPreviewPath = notePath;
        return;
      }

      documentSession.title = currentProposalPreview.title;
      proposalPreviewPath = notePath;
    } catch (error) {
      console.error('Failed to sync proposal preview into editor:', error);
      proposalErrorMessage = 'Unable to preview the proposed changes in the editor.';
    } finally {
      isSyncingProposalPreview = false;
    }
  }

  $effect(() => {
    documentSession.currentNotePath;
    documentSession.lastSavedTitle;
    hasCurrentProposalReview;
    currentProposalPreview?.title;
    void syncProposalPreviewToEditor();
  });

  function handleActiveWikilinkChange(paneId: PaneId, nextActiveWikilink: ActiveWikilink | null) {
    paneControllers[paneId].wikilinkController.handleActiveWikilinkChange(nextActiveWikilink);
  }

  function handleWikilinkKeydown(event: KeyboardEvent) {
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
      const shouldMount = paneOrder.includes(paneId) && getPaneKind(paneId) === 'editor';
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
        if (paneStates[paneId].editorGeneration >= paneDocument.sharedEditorStateGeneration) {
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
    if (searchQuery.trim() !== '') {
      scheduleSearch();
    }
    scheduleRelated({ immediate: true });
  }

  async function splitWorkspace() {
    if (paneOrder.length === 2) {
      activatePaneSession(SECONDARY_PANE_ID);
      return;
    }

    const sourcePaneId = paneOrder[0] ?? activePaneId;
    const targetPaneId =
      sourcePaneId === PRIMARY_PANE_ID ? SECONDARY_PANE_ID : PRIMARY_PANE_ID;
    const sharedDocument = getPaneDocumentSession(sourcePaneId);

    paneStates[targetPaneId].kind = 'editor';
    setPaneDocumentSession(targetPaneId, sharedDocument);
    paneOrder = [PRIMARY_PANE_ID, SECONDARY_PANE_ID];
    activatePaneSession(targetPaneId);
    await tick();
    await ensurePaneEditors();
    flushDocumentEditorSync(sharedDocument);
  }

  async function closePane(paneId: PaneId) {
    if (paneOrder.length === 1) {
      return;
    }

    const document = getPaneDocumentSession(paneId);
    paneOrder = paneOrder.filter((candidate) => candidate !== paneId);
    if (getPaneController(paneId)) {
      await ensurePaneEditors();
    }

    activatePaneSession((paneOrder[0] ?? PRIMARY_PANE_ID) as PaneId);
    updateSelectedRelatedText();
  }

  async function setPaneKind(paneId: PaneId, kind: PaneKind) {
    if (kind === paneStates[paneId].kind) {
      return;
    }

    const document = getPaneDocumentSession(paneId);
    paneStates[paneId].kind = kind;
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
      await enqueueSave('autosave');
      const pendingDocuments = new Set<DocumentSession>([
        documentSessionStore.activePane.document,
        ...documentSessionStore.documentsByKey.values()
      ]);
      await Promise.all([...pendingDocuments].map((document) => document.saveQueue));
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
      sessionController.dispose();
      cancelScheduledAutoSync();
      searchController.dispose();
      relatedController.dispose();
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
    class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-y border-border text-card-foreground shadow-sm sm:rounded-[2rem] sm:border"
    style={getCardStyle(relatedPanelPlacement, relatedDrawerReservedWidth)}
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
                      placeholder={getPaneTitlePlaceholder(paneStates[PRIMARY_PANE_ID].kind)}
                      value={getPaneDocumentSession(PRIMARY_PANE_ID).title}
                      readonly={isDocumentUnderProposal(getPaneDocumentSession(PRIMARY_PANE_ID))}
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

            {#if paneStates[PRIMARY_PANE_ID].kind === 'editor'}
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
                      placeholder={getPaneTitlePlaceholder(paneStates[SECONDARY_PANE_ID].kind)}
                      value={getPaneDocumentSession(SECONDARY_PANE_ID).title}
                      readonly={isDocumentUnderProposal(getPaneDocumentSession(SECONDARY_PANE_ID))}
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

            {#if paneStates[SECONDARY_PANE_ID].kind === 'editor'}
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
        {searchMode}
        {searchQuery}
        {searchResults}
        {recentNotes}
        {recentTasks}
        {isSearching}
        rememberActions={$rememberActionOptions}
        defaultRememberActionId={$defaultRememberActionPreference}
        integrateEnabled={canIntegrate()}
        integrateDisabledReason={integrateDisabledReason()}
        focusRequest={searchFocusRequest}
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

  {#if relatedPanelPlacement === 'side'}
    <aside
      class="related-drawer absolute top-0 bottom-0 z-20 flex min-h-0 items-stretch transition-[left] duration-300"
      aria-label="Related notes panel"
      style={getRelatedDrawerStyle(relatedDrawerReservedWidth)}
    >
      <div class="relative h-full min-h-0 w-full">
        <button
          type="button"
          class="related-drawer-handle group absolute -mx-4 top-1/2 left-0 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center"
          aria-expanded={!isRelatedPanelCollapsed}
          aria-controls="related-drawer-panel"
          aria-label={isRelatedPanelCollapsed ? 'Expand related notes' : 'Collapse related notes'}
          onclick={toggleRelatedPanel}
        >
          <span class="related-drawer-handle-pill flex h-28 w-7 items-center justify-center rounded-full border border-border/70 bg-card/92 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground shadow-lg backdrop-blur-md transition group-hover:text-foreground">
            <span class="-rotate-90">RELATED</span>
          </span>
        </button>

        <div
          id="related-drawer-panel"
          class={`absolute inset-y-0 left-0 flex w-full min-h-0 pl-4 transition-[opacity,transform] duration-300 ease-out ${
            isRelatedPanelCollapsed
              ? 'pointer-events-none translate-x-3 opacity-0'
              : 'pointer-events-auto translate-x-0 opacity-100'
          }`}
        >
          <div class="my-auto max-h-full w-full">
            <RelatedPanel
              items={relatedItems}
              scope={relatedScope}
              status={relatedStatus}
              reason={relatedReason}
              loading={isLoadingRelated}
              hasSelection={!!selectedRelatedText}
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
          class={`related-bottom-sheet-backdrop ${isRelatedPanelCollapsed ? 'hidden' : 'block'}`}
        ></div>
        <div
          id="related-drawer-panel"
          class={`related-bottom-sheet-panel w-full overflow-hidden transition-[opacity,transform] duration-300 ease-out ${
            isRelatedPanelCollapsed
              ? 'pointer-events-none translate-y-0 opacity-0'
              : 'pointer-events-auto translate-y-0 opacity-100'
          }`}
        >
          <RelatedPanel
            items={relatedItems}
            scope={relatedScope}
            status={relatedStatus}
            reason={relatedReason}
            loading={isLoadingRelated}
            hasSelection={!!selectedRelatedText}
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
          aria-expanded={!isRelatedPanelCollapsed}
          aria-controls="related-drawer-panel"
          aria-label={isRelatedPanelCollapsed ? 'Expand related notes' : 'Collapse related notes'}
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
