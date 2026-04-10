<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { onMount, tick } from 'svelte';
  import { cancelScheduledAutoSync, runAutoSyncNow, scheduleAutoSync } from '$lib/sync/autoSync';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';
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
  import type { EditorController } from '$lib/features/notepad/editor/editor';
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
  import {
    type SearchMode
  } from '$lib/features/notepad/search/search';
  import {
    storePastedImageAsset,
    type ForgottenNote,
    type SaveMode
  } from '$lib/features/notepad/session/session';
  import type { SessionSnapshot } from '$lib/features/notepad/session/session';
  import {
    activateDocumentSession as activateSharedDocumentSession,
    createDocumentSessionStore,
    discardDocumentSession as discardSharedDocumentSession,
    getActivePaneSession,
    resetActiveDocumentSession as resetSharedActiveDocumentSession,
    syncActiveDocumentSession as syncSharedActiveDocumentSession,
    type DocumentSession,
    type PaneSession
  } from '$lib/features/notepad/session/documentSession';
  import {
    createWikilinkAutocompleteState,
    type WikilinkAutocompleteState
  } from '$lib/features/notepad/wikilinks/state';
  import type { RecentTaskItem } from '$lib/features/notepad/model/types';
  import BottomBar from '$lib/features/notepad/ui/BottomBar.svelte';
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
  import { createEditorLifecycleController } from '$lib/features/notepad/editor/editorLifecycleController';
  import { createWikilinkController } from '$lib/features/notepad/wikilinks/controller';
  import {
    activeProposalSession,
    getProposalChangesForPath,
    toggleProposalChange,
    toggleProposalHunk,
    toggleProposalTitle
  } from '$lib/features/proposals/session';

  let crepe: EditorController | null = null;
  let shellEl: HTMLDivElement | null = null;
  let editorShell: HTMLDivElement | null = null;
  let editorRoot: HTMLDivElement | null = null;
  let slashMenuPortal: HTMLDivElement | null = null;
  let titleInput: HTMLInputElement | null = null;
  let titleShell: HTMLDivElement | null = null;
  let isEditorReady = $state(false);
  const documentSessionStore = createDocumentSessionStore();
  let paneSession = $state<PaneSession>(documentSessionStore.activePane);
  let documentSession = $state<DocumentSession>(documentSessionStore.activePane.document);
  let canUnforget = $state(false);
  let forgottenNote: ForgottenNote | null = null;
  let searchMode = $state<SearchMode>('all');
  let searchQuery = $state('');
  let searchResults = $state<SearchItem[]>([]);
  let recentNotes = $state<SearchItem[]>([]);
  let recentTasks = $state<RecentTaskItem[]>([]);
  let isSearching = $state(false);
  let searchFocusRequest = $state(0);
  let wikilinkAutocomplete = $state<WikilinkAutocompleteState>(createWikilinkAutocompleteState());
  let isRefreshingFromDisk = false;
  let isApplyingExternalContent = false;
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

  interface VaultNoteChangeEvent {
    notePath: string;
    deleted: boolean;
  }

  function getDocumentSession() {
    return documentSession;
  }

  function getPaneId() {
    return paneSession.paneId;
  }

  function activateDocumentSession(snapshot: SessionSnapshot) {
    activateSharedDocumentSession(documentSessionStore, snapshot);
    paneSession = getActivePaneSession(documentSessionStore);
    documentSession = paneSession.document;
    return documentSession;
  }

  function syncActiveDocumentSession(snapshot: SessionSnapshot) {
    syncSharedActiveDocumentSession(documentSessionStore, snapshot);
    paneSession = getActivePaneSession(documentSessionStore);
    documentSession = paneSession.document;
    return documentSession;
  }

  function resetActiveDocumentSession() {
    resetSharedActiveDocumentSession(documentSessionStore);
    paneSession = getActivePaneSession(documentSessionStore);
    documentSession = paneSession.document;
    return documentSession;
  }

  function discardDocumentSession(noteId: string | null, notePath: string | null) {
    discardSharedDocumentSession(documentSessionStore, noteId, notePath);
  }

  function getCurrentMarkdown() {
    return documentSession.bodyMarkdown;
  }

  function handleEditorMarkdownChange(document: DocumentSession, nextMarkdown: string) {
    document.bodyMarkdown = nextMarkdown;
    if (isApplyingExternalContent || isCurrentNoteUnderProposal) {
      return;
    }

    if (nextMarkdown.trim() !== '') {
      canUnforget = false;
    }

    scheduleAutosave();
    scheduleSearch();
    scheduleRelated();
  }

  function handleTitleInput(event: Event) {
    if (isCurrentNoteUnderProposal) {
      return;
    }
    documentSession.title = (event.currentTarget as HTMLInputElement).value;
    if (documentSession.title.trim() !== '' || documentSession.bodyMarkdown.trim() !== '') {
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

  function focusTitleAtEnd() {
    focusInputAtEnd(titleInput);
  }

  function getNavigationContext(): NavigationContext {
    return {
      editorRoot,
      titleShell,
      currentNoteId: documentSession.currentNoteId,
      currentNotePath: documentSession.currentNotePath,
      focusTitleAtEnd
    };
  }

  function getOpenContext(): OpenContext {
    return {
      currentNoteId: documentSession.currentNoteId,
      currentNotePath: documentSession.currentNotePath,
      stopPendingAutosave: cancelPendingAutosave,
      enqueueAutosave: () => enqueueSave('autosave'),
      clearSearch,
      openNotePath: async (noteId, notePath, options) => openNotePath(notePath, { noteId, ...options })
    };
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void focusEditorAtEnd(editorRoot);
  }

  async function handleSearchResultSelect(result: SearchItem) {
    await openSearchResult(getOpenContext(), getNavigationContext(), result);
    saveCursorPositionForNote();
  }

  async function handleRecentTaskSelect(task: RecentTaskItem) {
    await openRecentTask(getOpenContext(), getNavigationContext(), task);
    saveCursorPositionForNote();
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
    saveCursorPositionForNote();
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
      const deletedDocument = documentSessionStore.documentsByKey.get(`path:${payload.notePath}`);
      if (deletedDocument) {
        discardSharedEditorStateForDocument(deletedDocument);
      }
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

  const editorLifecycleController = createEditorLifecycleController({
    getController: () => crepe,
    getPaneId,
    setController: (value) => {
      crepe = value;
    },
    getShellElement: () => shellEl,
    getEditorShell: () => editorShell,
    getEditorRoot: () => editorRoot,
    getSlashMenuPortal: () => slashMenuPortal,
    getAssetRootPath: () => assetRootPath,
    getDocumentSession,
    setIsEditorReady: (value) => {
      isEditorReady = value;
    },
    setIsApplyingExternalContent: (value) => {
      isApplyingExternalContent = value;
    },
    handleEditorMarkdownChange,
    onTaskListToggle: () => {
      flushPendingAutosave();
    },
    onOpenLink: (rawTarget) => {
      void openWikilink(rawTarget);
    },
    onActiveWikilinkChange: handleActiveWikilinkChange,
    onStorePastedImage: storePastedImageAsset,
    closeTransientUi: closeWikilinkAutocomplete
  });

  const sessionController = createSessionController({
    getDocumentSession,
    activateDocumentSession,
    syncActiveDocumentSession,
    resetActiveDocumentSession,
    discardDocumentSession,
    isEditorReady: () => isEditorReady,
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

  const wikilinkController = createWikilinkController({
    getState: () => wikilinkAutocomplete,
    setState: (value) => {
      wikilinkAutocomplete = value;
    },
    getCurrentNoteId: () => documentSession.currentNoteId,
    getCurrentPath: () => documentSession.currentNotePath,
    getCurrentTitle: () => documentSession.title,
    getCurrentMarkdown,
    getEditorController: () => crepe,
    cancelPendingAutosave,
    enqueueAutosave: () => enqueueSave('autosave'),
    openNotePath: async (noteId, notePath, options) => openNotePath(notePath, { noteId, ...options }),
    getNavigationContext,
    saveCursorPositionForNote
  });

  async function destroyEditor() {
    await editorLifecycleController.destroyEditor();
  }

  async function createEditor(initialValue: string) {
    await editorLifecycleController.createEditor(initialValue);
  }

  function saveCursorPositionForNote() {
    editorLifecycleController.saveCursorPositionForDocument();
  }

  function saveCursorPositionForDocument(document?: DocumentSession) {
    editorLifecycleController.saveCursorPositionForDocument(document);
  }

  function saveSharedEditorStateForNote() {
    editorLifecycleController.saveSharedEditorStateForDocument();
  }

  function saveSharedEditorStateForDocument(document?: DocumentSession) {
    editorLifecycleController.saveSharedEditorStateForDocument(document);
  }

  function discardSharedEditorStateForDocument(document: DocumentSession) {
    editorLifecycleController.discardSharedEditorStateForDocument(document);
  }

  function restoreCursorPositionForNote() {
    return editorLifecycleController.restoreCursorPositionForDocument();
  }

  async function replaceEditorContent(
    nextMarkdown: string,
    options: {
      preserveScroll?: boolean;
      restoreCursor?: boolean;
    } = {}
  ) {
    await editorLifecycleController.replaceEditorContent(nextMarkdown, options);
  }

  async function replaceEditorContentInPlace(nextMarkdown: string) {
    await editorLifecycleController.replaceEditorContentInPlace(nextMarkdown);
  }

  async function replaceEditorContentInPlaceForDocument(
    nextMarkdown: string,
    document: DocumentSession
  ) {
    await editorLifecycleController.replaceEditorContentInPlaceForDocument(nextMarkdown, document);
  }

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
    await sessionController.clearNotepad(options);
  }

  async function unforgetNotepad() {
    await sessionController.unforgetNotepad();
  }

  async function loadSavedNote() {
    await sessionController.loadSavedNote();
  }

  async function loadAssetRoot() {
    await sessionController.loadAssetRoot();
  }

  async function refreshCurrentNoteIfChanged() {
    await sessionController.refreshCurrentNoteIfChanged();
  }

  function resolveRememberAction(actionId: string): RememberActionOption {
    return $rememberActionOptions.find((option) => option.id === actionId) ?? EXACT_REMEMBER_ACTION;
  }

  async function rememberCurrentNote(action: RememberActionOption) {
    const resolvedAction =
      rememberActionRequiresIntegrateSupport(action) && !canIntegrate()
        ? resolveRememberAction('exact')
        : action;
    await sessionController.rememberCurrentNote(
      resolvedAction,
      $cleanUpApplyPolicyPreference
    );
  }

  async function restoreSharedEditorStateForDocument(document: DocumentSession) {
    return editorLifecycleController.restoreSharedEditorStateForDocument(document);
  }

  async function openNotePath(
    notePath: string | null,
    options: { noteId?: string | null; currentNoteAlreadySaved?: boolean } = {}
  ) {
    await sessionController.openNotePath(options.noteId ?? null, notePath, {
      currentNoteAlreadySaved: options.currentNoteAlreadySaved ?? hasCurrentProposalReview
    });
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

  function closeWikilinkAutocomplete() {
    wikilinkController.closeWikilinkAutocomplete();
  }

  function handleActiveWikilinkChange(nextActiveWikilink: ActiveWikilink | null) {
    wikilinkController.handleActiveWikilinkChange(nextActiveWikilink);
  }

  function handleWikilinkKeydown(event: KeyboardEvent) {
    return wikilinkController.handleAutocompleteKeydown(event);
  }

  async function openWikilink(rawTarget: string) {
    await wikilinkController.openWikilink(rawTarget);
  }

  function handleWikilinkSuggestionSelect(value: string) {
    const state = wikilinkAutocomplete;
    const nextIndex = state.suggestions.findIndex((suggestion) => suggestion.value === value);
    if (nextIndex === -1) {
      return;
    }

    wikilinkAutocomplete = {
      ...state,
      selectedIndex: nextIndex
    };
    wikilinkController.selectWikilinkSuggestion(value);
  }

  function updateRelatedDrawerLayout() {
    updateRelatedDrawerLayoutController(shellEl);
  }

  function clearSelectedRelatedText() {
    clearSelectedRelatedTextController();
  }

  function updateSelectedRelatedText() {
    updateSelectedRelatedTextController(editorRoot);
  }

  function toggleRelatedPanel() {
    toggleRelatedPanelController(shellEl);
  }

  onMount(() => {
    let mounted = true;
    const unregisterPendingNoteSaveHandler = registerPendingNoteSaveHandler(async () => {
      cancelPendingAutosave();
      await enqueueSave('autosave');
    });
    const shellResizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updateRelatedDrawerLayout();
          });

    (async () => {
      await tick();
      if (!mounted || !editorRoot) return;
      await Promise.all([loadSavedNote(), loadAssetRoot(), loadRememberCapabilities()]);
      if (!mounted || !editorRoot) return;
      try {
        await createEditor(documentSession.bodyMarkdown);
        restoreCursorPositionForNote();
        clearSelectedRelatedText();
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

    if (shellEl && shellResizeObserver) {
      shellResizeObserver.observe(shellEl);
    }

    return () => {
      mounted = false;
      isEditorReady = false;
      saveCursorPositionForNote();
      saveSharedEditorStateForNote();
      flushPendingAutosave();
      editorLifecycleController.dispose();
      sessionController.dispose();
      cancelScheduledAutoSync();
      searchController.dispose();
      relatedController.dispose();
      unregisterPendingNoteSaveHandler();
      vaultNoteChangeUnlisten?.();
      vaultNoteChangeUnlisten = null;
      shellResizeObserver?.disconnect();
      void destroyEditor();
    };
  });

  $effect(() => {
    if (!isEditorReady || !editorRoot) {
      return;
    }

    const proseMirror = editorRoot.querySelector('.ProseMirror');
    if (!(proseMirror instanceof HTMLElement)) {
      return;
    }

    const persistCursorPosition = () => {
      saveCursorPositionForNote();
    };

    const handleSelectionChange = () => {
      updateSelectedRelatedText();
    };

    proseMirror.addEventListener('keyup', persistCursorPosition);
    proseMirror.addEventListener('mouseup', persistCursorPosition);
    proseMirror.addEventListener('touchend', persistCursorPosition);
    proseMirror.addEventListener('focusout', persistCursorPosition);
    proseMirror.addEventListener('keyup', handleSelectionChange);
    proseMirror.addEventListener('mouseup', handleSelectionChange);
    proseMirror.addEventListener('touchend', handleSelectionChange);
    proseMirror.addEventListener('focusout', handleSelectionChange);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      proseMirror.removeEventListener('keyup', persistCursorPosition);
      proseMirror.removeEventListener('mouseup', persistCursorPosition);
      proseMirror.removeEventListener('touchend', persistCursorPosition);
      proseMirror.removeEventListener('focusout', persistCursorPosition);
      proseMirror.removeEventListener('keyup', handleSelectionChange);
      proseMirror.removeEventListener('mouseup', handleSelectionChange);
      proseMirror.removeEventListener('touchend', handleSelectionChange);
      proseMirror.removeEventListener('focusout', handleSelectionChange);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  });
</script>

<svelte:window onkeydowncapture={handleGlobalKeydown} onfocus={handleWindowFocus} onresize={handleWindowResize} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<div bind:this={shellEl} class="notepad-shell relative h-full w-full min-h-0 overflow-visible">
  <div
    class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-y border-border text-card-foreground shadow-sm transition-all duration-300 sm:rounded-[2rem] sm:border"
    style={getCardStyle(relatedPanelPlacement, relatedDrawerReservedWidth)}
  >
      <!-- Title bar -->
      <div class="absolute top-0 left-0 right-0 z-20">
        <div class="relative">
          <div
            class="pointer-events-none absolute inset-0 bg-card/70 backdrop-blur-md"
            style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
          ></div>
          <div class="relative z-10 px-4 pt-2 pb-2 sm:px-8 sm:pt-3 sm:pb-4">
            <div bind:this={titleShell} class="mx-auto flex w-full max-w-3xl flex-col items-start gap-1 rounded-[1.4rem] px-0 py-1 transition-all duration-300 sm:items-center sm:gap-2 sm:px-4 sm:py-2">
              <div class="flex w-full items-center justify-start gap-3 text-[1.35rem] font-semibold tracking-tight text-foreground sm:justify-center sm:text-3xl">
                <input
                  bind:this={titleInput}
                  type="text"
                  class={`w-full max-w-2xl bg-transparent text-left outline-none placeholder:text-muted-foreground/55 sm:text-center ${
                    isCurrentNoteUnderProposal ? 'cursor-default text-muted-foreground' : ''
                  }`}
                  placeholder="Title"
                  value={documentSession.title}
                  readonly={isCurrentNoteUnderProposal}
                  oninput={handleTitleInput}
                  onblur={handleTitleBlur}
                  onkeydown={handleTitleKeydown}
                />
              </div>
              <div class="h-px w-16 rounded-full bg-border sm:w-40"></div>
            </div>
          </div>
        </div>
      </div>
      <!-- Editor Area -->
      <div class="flex-1 min-h-0">
        <div
          bind:this={editorShell}
          class="notepad-editor-shell relative h-full"
        >
          {#if !isEditorReady}
            <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <span class="rounded-full bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
                Loading editor
              </span>
            </div>
          {/if}

          <div bind:this={editorRoot} class={`min-h-full ${hasCurrentProposalReview ? 'hidden' : ''}`}></div>
          {#if hasCurrentProposalReview}
            <section class="mx-auto min-h-full w-full max-w-3xl px-4 pt-24 pb-28 sm:px-8 sm:pt-28">
              {#if proposalErrorMessage}
                <div class="mb-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {proposalErrorMessage}
                </div>
              {/if}

              <ProposalReviewList
                reviewChanges={currentProposalChanges}
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
      <!-- Bottom Bar -->
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
  <div bind:this={slashMenuPortal} class="notepad-slash-portal fixed inset-0 z-40 pointer-events-none"></div>
  <WikilinkAutocomplete
    active={wikilinkAutocomplete.active}
    activeWikilink={wikilinkAutocomplete.activeWikilink}
    suggestions={wikilinkAutocomplete.suggestions}
    selectedIndex={wikilinkAutocomplete.selectedIndex}
    onSelect={(suggestion) => handleWikilinkSuggestionSelect(suggestion.value)}
  />
</div>

<style>
  .notepad-shell {
    --editor-left-padding: 1rem;
    --editor-right-padding: 1rem;
    --editor-readable-width: 100%;
    --editor-top-padding: 4.25rem;
    --editor-bottom-padding: calc(7rem + env(safe-area-inset-bottom, 0px));
    --related-drawer-gap: 1rem;
    --related-drawer-peek-width: 2.75rem;
    --related-bottom-offset: calc(6.1rem + env(safe-area-inset-bottom, 0px));
    overflow: visible;
  }

  @media (min-width: 640px) {
    .notepad-shell {
      --editor-left-padding: 3.75rem;
      --editor-right-padding: 1.5rem;
      --editor-readable-width: 44rem;
      --editor-top-padding: 6rem;
      --editor-bottom-padding: 100%;
    }
  }

  @media (min-width: 1024px) {
    .notepad-shell {
      --editor-left-padding: 5.5rem;
      --editor-right-padding: 2.5rem;
      --editor-readable-width: 48rem;
    }
  }

  @media (min-width: 1440px) {
    .notepad-shell {
      --editor-left-padding: 7.25rem;
      --editor-right-padding: 3.5rem;
      --editor-readable-width: 52rem;
    }
  }

  .notepad-editor-shell {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
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
  .notepad-editor-shell :global(.gn-editor-root),
  .notepad-slash-portal {
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
    --gn-task-checkbox-check: color-mix(in oklab, var(--foreground) 88%, white 12%);
  }

  :global(.dark) .notepad-shell,
  :global(.dark) .notepad-editor-shell :global(.gn-editor-root),
  :global(.dark) .notepad-slash-portal {
    --gn-task-checkbox-border: color-mix(in oklab, white 26%, var(--card) 74%);
    --gn-task-checkbox-bg: color-mix(in oklab, white 12%, var(--card) 88%);
    --gn-task-checkbox-checked-border: color-mix(in oklab, white 42%, var(--card) 58%);
    --gn-task-checkbox-checked-bg: color-mix(in oklab, white 26%, var(--card) 74%);
    --gn-task-checkbox-check: color-mix(in oklab, white 96%, var(--card) 4%);
  }

  .notepad-editor-shell :global(.gn-editor-root) {
    min-height: 100%;
    width: 100%;
    max-width: 100%;
    overflow-x: clip;
  }

  /* Hide the + button that adds a new line in the block handle */
  .notepad-editor-shell :global(.gn-editor-root .milkdown-block-handle .operation-item:first-child) {
    display: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror) {
    box-sizing: border-box;
    min-height: 100%;
    max-width: 100%;
    width: min(
      100%,
      calc(var(--editor-readable-width) + var(--editor-left-padding) + var(--editor-right-padding))
    );
    margin-inline: auto;
    padding-top: var(--editor-top-padding);
    padding-left: var(--editor-left-padding);
    padding-right: var(--editor-right-padding);
    padding-bottom: var(--editor-bottom-padding);
    overflow-anchor: auto;
    position: relative;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror > *) {
    max-width: 100%;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror) {
    color: var(--foreground);
    line-height: 1.75;
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
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

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h1) {
    font-size: 2rem;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h2) {
    font-size: 1.6rem;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h3) {
    font-size: 1.32rem;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h4),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h5),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror h6) {
    font-size: 1.08rem;
  }

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

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror hr) {
    margin: 1.25rem 0;
    border: 0;
    border-top: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror table) {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror th),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror td) {
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    vertical-align: top;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror th) {
    background: color-mix(in oklab, var(--muted) 72%, var(--background));
    font-weight: 600;
    text-align: left;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ul),
  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ol) {
    padding-left: 1.4rem;
    list-style-position: outside;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ul) {
    list-style-type: disc;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ol) {
    list-style-type: decimal;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ul ul) {
    list-style-type: circle;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror ul ul ul) {
    list-style-type: square;
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
    cursor: pointer;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
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
    transform-origin: center;
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

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror *::-moz-selection) {
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

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-wikilink:hover) {
    background: color-mix(in oklab, var(--accent) 72%, transparent);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-image-embed-source) {
    display: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-image-embed) {
    display: block;
    position: relative;
    max-width: min(100%, 42rem);
    margin: 0.9rem 0;
    cursor: text;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-image-embed img) {
    display: block;
    width: auto;
    max-width: 100%;
    height: auto;
    border-radius: 0.9rem;
    border: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--card) 92%, var(--background));
    box-shadow:
      0 14px 28px -24px color-mix(in oklab, var(--foreground) 34%, transparent),
      0 4px 12px -8px color-mix(in oklab, var(--foreground) 18%, transparent);
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-image-embed-resize-handle) {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    width: 1rem;
    height: 1rem;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--background) 72%, transparent);
    background: color-mix(in oklab, var(--foreground) 76%, var(--accent) 24%);
    box-shadow: 0 3px 10px -6px color-mix(in oklab, var(--foreground) 60%, transparent);
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-image-embed:hover .gn-image-embed-resize-handle) {
    opacity: 1;
  }

  .notepad-editor-shell :global(.gn-editor-root .ProseMirror .gn-image-embed[data-broken='true'] img) {
    opacity: 0.45;
    filter: grayscale(1);
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

  .notepad-editor-shell :global(.ProseMirror.virtual-cursor-enabled) {
    caret-color: transparent;
  }

  /* Below title (z-20) and bottom bar (z-30) so scrolling doesn’t paint the handle over chrome. */
  .notepad-editor-shell :global(.gn-editor-root .milkdown-block-handle) {
    position: fixed;
    z-index: 8;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: color-mix(in oklab, var(--foreground) 78%, var(--muted-foreground) 22%);
  }

  .notepad-editor-shell :global(.gn-editor-root .milkdown-block-handle[data-show='false']) {
    display: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .milkdown-block-handle .operation-item) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--border) 82%, var(--foreground) 18%);
    background: color-mix(in oklab, var(--card) 94%, var(--background));
    box-shadow: 0 12px 24px -20px color-mix(in oklab, var(--foreground) 32%, transparent);
  }

  .notepad-editor-shell :global(.gn-editor-root .milkdown-block-handle .operation-item:last-child) {
    cursor: grab;
  }

  .notepad-editor-shell :global(.gn-editor-root .milkdown-block-handle[data-dragging='true'] .operation-item:last-child) {
    cursor: grabbing;
  }

  /* Let hit-testing see blocks under the fixed handle while dragging (Milkdown-style). */
  .notepad-editor-shell :global(.gn-editor-root .milkdown-block-handle[data-dragging='true']) {
    pointer-events: none;
  }

  .notepad-editor-shell :global(.gn-editor-root .milkdown-block-handle .operation-item.active) {
    background: color-mix(in oklab, var(--accent) 88%, var(--background));
  }

  .notepad-editor-shell :global(.gn-editor-root .gn-block-drop-indicator) {
    position: fixed;
    z-index: 7;
    height: 0;
    border-top: 3px solid color-mix(in oklab, var(--accent) 88%, var(--foreground) 12%);
    border-radius: 999px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 90ms ease;
  }

  .notepad-editor-shell :global(.gn-editor-root .gn-block-drop-indicator[data-show='true']) {
    opacity: 1;
  }

  :global(body.gn-block-dragging) {
    cursor: grabbing;
    user-select: none;
  }

  :global(.dark) .notepad-editor-shell :global(.gn-editor-root .ProseMirror-focused) {
    --prosemirror-virtual-cursor-color: color-mix(
      in oklab,
      var(--foreground) 88%,
      var(--accent) 12%
    );
  }

  .notepad-slash-portal :global(.milkdown-slash-menu) {
    pointer-events: auto;
    z-index: 60;
    width: min(26rem, calc(100vw - 2rem));
    border-radius: 1rem;
    border: 1px solid color-mix(in oklab, var(--border) 84%, var(--foreground) 16%);
    background: color-mix(in oklab, var(--card) 94%, var(--background));
    box-shadow:
      0 16px 40px -28px color-mix(in oklab, var(--foreground) 42%, transparent),
      0 8px 18px -16px color-mix(in oklab, var(--foreground) 18%, transparent);
    overflow: hidden;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu[data-show='false']) {
    display: none;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .tab-group) {
    border-bottom: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--muted) 66%, var(--background));
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .tab-group ul) {
    display: flex;
    gap: 0.2rem;
    margin: 0;
    padding: 0.45rem 0.45rem 0.35rem;
    list-style: none;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .tab-group li) {
    padding: 0.28rem 0.55rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--muted-foreground);
    text-transform: uppercase;
    cursor: pointer;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .tab-group li.selected) {
    background: color-mix(in oklab, var(--accent) 88%, var(--background));
    color: var(--foreground);
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .menu-groups) {
    max-height: min(420px, var(--notepad-slash-menu-max-height, calc(100vh - 2rem)));
    overflow-y: auto;
    padding: 0.45rem;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .menu-group + .menu-group) {
    margin-top: 0.45rem;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .menu-group h6) {
    margin: 0 0 0.35rem;
    padding: 0 0.4rem;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--muted-foreground);
    text-transform: uppercase;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .menu-group ul) {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu li[data-index]) {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.7rem;
    border-radius: 0.85rem;
    color: var(--foreground);
    cursor: pointer;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu li[data-index] svg) {
    width: 1.2rem;
    height: 1.2rem;
    flex: 0 0 auto;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu li[data-index].hover),
  .notepad-slash-portal :global(.milkdown-slash-menu li[data-index].active) {
    background: color-mix(in oklab, var(--accent) 88%, var(--background));
  }

  :global(.notepad-block-type-menu) {
    --crepe-color-surface: color-mix(in oklab, var(--card) 92%, var(--background));
    --crepe-color-on-surface: var(--card-foreground);
    --crepe-color-outline: color-mix(in oklab, var(--border) 82%, var(--foreground));
    --crepe-color-hover: color-mix(in oklab, var(--accent) 82%, transparent);
    --crepe-color-selected: color-mix(in oklab, var(--accent) 92%, var(--background));

    position: fixed;
    z-index: 50;
    display: block;
    font-family: var(--font-sans);
    color: var(--crepe-color-on-surface);
    background: var(--crepe-color-surface);
    border-radius: 12px;
    box-shadow:
      0px 1px 3px 1px rgba(0, 0, 0, 0.15),
      0px 1px 2px 0px rgba(0, 0, 0, 0.3);
  }

  :global(.notepad-block-type-menu[data-open='false']) {
    display: none;
  }

  :global(.notepad-block-type-menu-tabs) {
    border-bottom: 1px solid color-mix(in srgb, var(--crepe-color-outline), transparent 80%);
    padding: 12px 12px 0;
  }

  :global(.notepad-block-type-menu-tabs ul) {
    list-style-type: none;
    margin: 0;
    padding: 8px 10px;
    display: flex;
    gap: 10px;
    flex-wrap: nowrap;
  }

  :global(.notepad-block-type-menu-tabs ul li) {
    padding: 6px 10px;
    font-size: 14px;
    font-style: normal;
    font-weight: 600;
    line-height: 20px;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
  }

  :global(.notepad-block-type-menu-tabs ul li:hover) {
    background: var(--crepe-color-hover);
  }

  :global(.notepad-block-type-menu-tabs ul li.selected) {
    background: var(--crepe-color-selected);
  }

  :global(.notepad-block-type-menu-groups) {
    padding: 0 12px 12px;
    max-height: min(420px, calc(100vh - 24px));
    overflow: auto;
    overscroll-behavior: contain;
    scroll-behavior: smooth;
  }

  :global(.notepad-block-type-menu-group h6) {
    font-size: 14px;
    font-style: normal;
    font-weight: 600;
    line-height: 20px;
    padding: 14px 10px;
    text-transform: uppercase;
    margin: 0;
    color: color-mix(in srgb, var(--crepe-color-on-surface), transparent 40%);
  }

  :global(.notepad-block-type-menu-group + .notepad-block-type-menu-group)::before {
    content: '';
    display: block;
    height: 1px;
    background: color-mix(in srgb, var(--crepe-color-outline), transparent 80%);
    margin: 0 10px;
  }

  :global(.notepad-block-type-menu-item) {
    min-width: 220px;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 16px;
    padding: 14px 10px;
    border: none;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
    width: 100%;
  }

  :global(.notepad-block-type-menu-item > span) {
    font-size: 14px;
    font-style: normal;
    font-weight: 600;
    line-height: 20px;
  }

  :global(.notepad-block-type-menu-item > svg) {
    width: 24px;
    height: 24px;
    color: var(--crepe-color-outline);
    fill: var(--crepe-color-outline);
    flex-shrink: 0;
  }

  :global(.notepad-block-type-menu-item:hover) {
    background: var(--crepe-color-hover);
  }

  :global(.notepad-block-type-menu-item[data-active='true']) {
    background: var(--crepe-color-selected);
  }
</style>
