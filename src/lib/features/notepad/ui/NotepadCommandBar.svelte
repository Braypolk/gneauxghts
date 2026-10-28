<script lang="ts">
  import { keyboardShortcutMatchesEvent } from '#lib/keyboardShortcuts.svelte.js';

  import { noteFileLabel } from '#lib/noteLabels.js';
  import RelatedResults from '../related/RelatedResults.svelte';
  import type { RelatedView } from '../related/store.svelte';
  import WorkspaceInputDock from './WorkspaceInputDock.svelte';
  import SearchResultsPanel from '#lib/ui/search/SearchResultsPanel.svelte';
  import SearchResultsHeading from '#lib/ui/search/SearchResultsHeading.svelte';
  import SearchNoteResult from '#lib/ui/search/SearchNoteResult.svelte';
  import SplitSearchResultAction from '#lib/ui/search/SplitSearchResultAction.svelte';
  import { hasSplitDiscoveryDestination } from '../navigation/splitNoteDestination';
  import type { DockActionPresentation } from './workspaceDockPresentation';
  import { ramp as dockRamp } from '#lib/ui/morphing-containers/motion.js';
  import { onDestroy, tick, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { rankMediaResults } from '../search/mediaRanking';
  import ImageSearchResult from '../search/ImageSearchResult.svelte';
  import { createImageAssetLoader } from '../images/imageAssetLoader';
  import {
    Eraser,
    Undo2,
    SquarePen,
    MessagesSquare,
    Pin,
    PinOff,
  } from '@lucide/svelte';
  import {
    appSettings,
    resolveForgetButtonDurationMs
  } from '#lib/appSettings.svelte.js';
  import {
    buildHighlightedSegments,
    createNotepadCommandBarState,
    deriveNotepadCommandBarVisibleItems,
    type NotepadCommandBarVisibleItem
  } from '#lib/features/notepad/ui/notepadCommandBarState.svelte.js';
  import type {
    NotepadCommandBarForgetProps,
    NotepadCommandBarRememberProps,
    NotepadCommandBarSearchProps,
    NotepadCommandBarRelatedProps
  } from '#lib/features/notepad/ui/notepadCommandBarProps.js';
  import SearchBar, {
    type SearchBarHandle,
    type SearchChoice
  } from '#lib/ui/search/SearchBar.svelte';
  import '#lib/ui/search/searchDock.css';
  import type { ImageSearchItem, SearchItem } from '#lib/types/semantic.js';
  import type { LocationHistoryEntry } from '#lib/features/notepad/navigation/locationMru.js';
  import type { SearchResultType, SearchEditedWindow } from '../search/search';

  interface Props {
    forget: NotepadCommandBarForgetProps;
    remember: NotepadCommandBarRememberProps;
    search: NotepadCommandBarSearchProps;
    related?: NotepadCommandBarRelatedProps;
    chatAvailable?: boolean;
    dockMode?: 'search' | 'chat';
    chatSlot?: HTMLDivElement | null;
    onDockModeChange?: (mode: 'search' | 'chat') => void;
    onExpandChat?: () => void;
  }

  let {
    forget,
    remember,
    search,
    related,
    chatAvailable = false,
    dockMode = 'search',
    chatSlot = $bindable(null),
    onDockModeChange,
    onExpandChat
  }: Props = $props();

  const relatedPopupId = $props.id();
  let relatedMode = $state(false);
  let relatedView = $state<RelatedView>('related');
  let relatedControls = $state<HTMLDivElement | null>(null);
  function selectRelatedView(view: RelatedView) {
    if (view === relatedView) return;
    relatedView = view;
    relatedIndex = 0;
    related?.onOpen(view);
  }
  function handleRelatedViewKeydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); event.stopPropagation();
      selectRelatedView(event.key === 'ArrowLeft' ? 'related' : 'backlinks');
      void tick().then(() => relatedControls?.querySelector<HTMLButtonElement>(`[data-related-view="${relatedView}"]`)?.focus());
    }
  }
  let panelOpen = $state(false);
  let relatedIndex = $state(0);
  let relatedHeader = $state<HTMLButtonElement | null>(null);
  let openedRelatedKey: string | null = null;

  function closeRelated(restore = false) {
    if (restore) onSearchDismiss?.();
    searchBar?.closeSearch();
  }
  function showSearch() {
    if (relatedMode) { relatedMode = false; related?.onClose(); }
  }
  export function toggleRelated() {
    if (!related?.contextKey) return;
    if (relatedMode) { closeRelated(true); return; }
    openedRelatedKey = related.contextKey;
    relatedMode = true;
    relatedIndex = 0;
    related.onOpen(relatedView);
    searchBar?.openPanel();
    void tick().then(() => relatedHeader?.focus({ preventScroll: true }));
  }
  $effect(() => {
    const key = related?.contextKey;
    if (relatedMode && key !== openedRelatedKey) closeRelated();
  });
  function handleWindowKeydown(event: KeyboardEvent) {
    // Related has no text input: Select All must not fall through to the page.
    if (relatedMode && (event.metaKey || event.ctrlKey)
      && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    commandBarState.handleForgetShortcutKeyDown(event);
  }
  function handleRelatedKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (event.target === relatedHeader && keyboardShortcutMatchesEvent(event, 'searchOpenInSplit')) {
      const item = related?.result?.items[relatedIndex];
      if (item && related?.onOpenInSplit && hasSplitDiscoveryDestination(item)) {
        event.preventDefault(); chooseSplit(() => related?.onOpenInSplit?.(item)); return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeRelated(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = related?.result?.items.length ?? 0;
      if (count) {
        relatedIndex = (relatedIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        const moveFocus = event.target !== relatedHeader;
        void tick().then(() => {
          const row = relatedHeader?.closest('.workspace-input-dock')
            ?.querySelector<HTMLElement>('[data-search-result-active="true"]');
          if (moveFocus) row?.focus({ preventScroll: true });
          row?.scrollIntoView({ block: 'nearest' });
        });
      }
    } else if (event.key === 'ArrowRight' && event.target === relatedHeader
      && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      const row = relatedHeader?.closest('.workspace-input-dock')
        ?.querySelector<HTMLElement>('[data-search-result-active="true"]');
      const split = row?.parentElement?.querySelector<HTMLButtonElement>('[data-search-split-action]');
      if (split) { event.preventDefault(); split.focus(); }
    } else if (event.key === 'Enter' && event.target === relatedHeader) {
      event.preventDefault();
      const item = related?.result?.items[relatedIndex];
      if (item) {
        selectRelated(item);
      }
    }
  }
  function selectRelated(item: import('#lib/types/semantic.js').RelatedNoteItem) {
    onSearchCommit?.();
    searchBar?.closeSearch();
    related?.onSelect(item);
  }
  function chooseSplit(action: () => void) {
    onSearchCommit?.();
    searchBar?.closeSearch();
    action();
  }

  const canUnforget = $derived(forget.canUnforget);
  const canForget = $derived(forget.canForget ?? true);
  const forgetItemLabel = $derived(forget.itemLabel ?? 'note');
  const onForget = $derived(forget.onForget);
  const onUnforget = $derived(forget.onUnforget);

  const onRemember = $derived(remember.onRemember);
  const rememberLabel = $derived(remember.label ?? 'New Idea');
  const rememberAriaLabel = $derived(
    remember.ariaLabel ?? `${rememberLabel}. Start a blank note.`
  );

  const searchMode = $derived(search.searchMode);
  const resultType = $derived(search.resultType ?? 'all');
  const editedWindow = $derived(search.editedWindow ?? 'any');
  let resultPreview = $state<{ context: string; query: string; items: NotepadCommandBarVisibleItem[] } | null>(null);
  let presentationQuiet = $state(true);
  let presentationTimer: number | null = null;
  function clearPresentation() {
    if (presentationTimer !== null) window.clearTimeout(presentationTimer);
    presentationTimer = null;
    presentationQuiet = true;
    resultPreview = null;
  }
  onDestroy(() => { if (presentationTimer !== null) window.clearTimeout(presentationTimer); });
  function beginSearchUpdate() {
    // Preserve the last displayed list before canonical query preparation clears
    // it. Move focus first, so making old rows inert cannot dismiss the popup.
    if (searchResultsViewport?.contains(document.activeElement)) searchBar?.focusSearch();
    if (retainedSearchItems === null) {
      resultPreview = { context: searchPresentationContext, query: searchQuery, items: [...visibleItems] };
    }
    presentationQuiet = false;
    if (presentationTimer !== null) window.clearTimeout(presentationTimer);
    presentationTimer = window.setTimeout(() => {
      presentationTimer = null;
      presentationQuiet = true;
    }, 250);
  }
  function changeResultType(type: SearchResultType) {
    if (type === resultType) return;
    beginSearchUpdate();
    void search.onResultTypeChange?.(type);
  }
  function changeEditedWindow(window: SearchEditedWindow) {
    if (window === editedWindow) return;
    beginSearchUpdate();
    void search.onEditedWindowChange?.(window);
  }
  const resultTypeChoices: { id: SearchResultType; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'notes', label: 'Notes' }, { id: 'images', label: 'Images' }
  ];
  const editedWindowChoices: { id: SearchEditedWindow; label: string; description: string }[] = [
    { id: 'any', label: 'Any time', description: 'Search edits from any time' },
    { id: '7d', label: '7 days', description: 'Edited in last 7 days' },
    { id: '30d', label: '30 days', description: 'Edited in last 30 days' }
  ];
  function handleSearchCueKeydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape') {
      commandBarState.handleSearchKeydown(event);
      searchBar?.focusSearch();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      commandBarState.resetActiveIndex();
      commandBarState.searchNavigationMode = 'keyboard';
      searchBar?.focusSearch();
    }
  }
  const imageResults = $derived(search.imageResults ?? []);
  const imageQueryUrl = $derived(search.imageQueryUrl ?? null);
  const thumbnails = createImageAssetLoader(key => {
    const [fileName, assetHash] = JSON.parse(key) as [string, string];
    return invoke<string>('read_image_search_thumbnail', { fileName, assetHash });
  }, () => 'running-vault', undefined, { entries: 24, bytes: 6 * 1024 * 1024 });
  onDestroy(() => thumbnails.destroy());
  function loadThumbnail(item: ImageSearchItem) {
    return thumbnails.load(JSON.stringify([item.assetName, item.assetHash]));
  }
  function chooseImage(file: File) { searchBar?.focusSearch(); void search.onQueryImage?.(file); }
  const searchQuery = $derived(search.searchQuery);
  const matchCase = $derived(search.matchCase);
  const matchWholeWord = $derived(search.matchWholeWord);
  const searchResults = $derived(search.searchResults);
  const pinnedNotes = $derived(search.pinnedNotes);
  const recentLocations = $derived(search.recentLocations);
  const lastEditedNotes = $derived(search.lastEditedNotes ?? []);
  let browseMode = $state<'recent' | 'edited'>('recent');
  let browseControls = $state<HTMLDivElement | null>(null);
  function selectBrowseMode(mode: 'recent' | 'edited') {
    browseMode = mode;
    commandBarState.resetActiveIndex();
    if (mode === 'edited') void search.onLoadLastEdited?.();
  }
  function focusBrowseMode() {
    browseControls?.querySelector<HTMLButtonElement>(`[data-browse-mode="${browseMode}"]`)?.focus();
  }
  function handleBrowseModeKeydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectBrowseMode(event.key === 'ArrowLeft' ? 'recent' : 'edited');
      void tick().then(focusBrowseMode);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      commandBarState.resetActiveIndex();
      commandBarState.searchNavigationMode = 'keyboard';
      searchBar?.focusSearch();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
    } else if (event.key === 'Escape') {
      commandBarState.handleSearchKeydown(event);
    }
  }
  function focusResultAction(index: number, split: boolean) {
    const row = searchResultsViewport?.querySelector<HTMLElement>(`[data-search-result-index="${index}"]`);
    const target = split ? row?.querySelector<HTMLButtonElement>('[data-search-split-action]') : null;
    (target ?? row?.querySelector<HTMLButtonElement>('.search-result-item, .image-search-result'))?.focus({ preventScroll: true });
  }
  function handleSearchResultsKeydown(event: KeyboardEvent) {
    if (relatedMode || event.defaultPrevented || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[data-search-result-index]');
    if (!row || !event.target.matches('.search-result-item, .image-search-result, [data-search-split-action]')) return;
    if (keyboardShortcutMatchesEvent(event, 'searchOpenInSplit') && !retainedSearchItems) {
      const item = visibleItems[Number(row.dataset.searchResultIndex)];
      if (item && commandBarState.openItemInSplit(item)) { event.preventDefault(); return; }
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowRight') {
      const split = row.querySelector<HTMLButtonElement>('[data-search-split-action]');
      if (split) { event.preventDefault(); split.focus(); }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const index = Number(row.dataset.searchResultIndex);
      if (commandBarState.activeIndex !== index) commandBarState.handleSearchItemFocus(index);
      const movesToBrowse = event.key === 'ArrowUp' && index === 0 && searchQuery.trim() === '' && !imageQueryUrl;
      const split = event.target.hasAttribute('data-search-split-action');
      commandBarState.handleSearchKeydown(event);
      if (!movesToBrowse) void tick().then(() => focusResultAction(commandBarState.activeIndex, split));
    } else if (event.key === 'Escape') {
      const hadQuery = searchQuery.trim() !== '' || imageQueryUrl !== null;
      commandBarState.handleSearchKeydown(event);
      if (hadQuery) searchBar?.focusSearch();
    }
  }
  const isSearching = $derived(search.isSearching);
  function onSearchInput(value: string) {
    if (value.trim() === '' && !imageQueryUrl) clearPresentation();
    else if (value !== searchQuery) beginSearchUpdate();
    search.onSearchInput(value);
  }
  function onSearchClear() {
    clearPresentation();
    if (search.onSearchClear) search.onSearchClear();
    else search.onSearchInput('');
  }
  const onSearchModeChange = $derived(search.onSearchModeChange);
  function onMatchCaseChange(enabled: boolean) {
    if (searchQuery.trim() !== '' || imageQueryUrl) beginSearchUpdate();
    void search.onMatchCaseChange(enabled);
  }
  function onMatchWholeWordChange(enabled: boolean) {
    if (searchQuery.trim() !== '' || imageQueryUrl) beginSearchUpdate();
    void search.onMatchWholeWordChange(enabled);
  }
  const onSearchSelect = $derived(search.onSearchSelect);
  const onSearchNavigate = $derived(search.onSearchNavigate);
  const onPinnedNoteSelect = $derived(search.onPinnedNoteSelect);
  const onSetNotePinned = $derived(search.onSetNotePinned);
  const onRecentLocationSelect = $derived(search.onRecentLocationSelect);
  const onRecentLocationShortcut = $derived(search.onRecentLocationShortcut);
  const onSearchOpen = $derived(search.onSearchOpen);
  const onSearchDismiss = $derived(search.onSearchDismiss);
  const onSearchCommit = $derived(search.onSearchCommit);
  const onCommand = $derived(search.onCommand);
  const searchScopeTitle = $derived(
    searchMode === 'current'
      ? 'Searching only the current note'
      : 'Searching across all notes'
  );
  const searchScopeOptions = [
    {
      id: 'current',
      label: 'This note',
      ariaLabel: 'Search this note only',
      title: 'Search this note only'
    },
    {
      id: 'all',
      label: 'All notes',
      shortLabel: 'All notes',
      ariaLabel: 'Search all notes',
      title: 'Search all notes',
      tone: 'all'
    }
  ] satisfies SearchChoice[];

  let searchBar = $state<SearchBarHandle | null>(null);
  let actionPresentation = $state<DockActionPresentation>({ running: false, progress: 1 });
  let previousRememberLabel = $state(untrack(() => rememberLabel));
  const outgoingRememberLabel = $derived(previousRememberLabel !== rememberLabel ? previousRememberLabel : null);
  const rememberLabelPrefix = $derived(rememberLabel.startsWith('New ')
    && (!outgoingRememberLabel || outgoingRememberLabel.startsWith('New ')) ? 'New ' : '');
  $effect(() => {
    const running = actionPresentation.running;
    untrack(() => {
      if (!running) previousRememberLabel = rememberLabel;
    });
  });
  $effect(() => {
    const label = rememberLabel;
    // A pane-owner change can update the label without requesting a morph.
    // Wait for this render's dock request before accepting it as settled.
    void tick().then(() => {
      if (!actionPresentation.running) previousRememberLabel = label;
    });
  });
  let searchResultsViewport = $state<HTMLDivElement | null>(null);
  let forgetButton = $state<HTMLButtonElement | null>(null);
  let forgetCancelButton = $state<HTMLButtonElement | null>(null);
  let forgetHoldDurationMs = $derived(resolveForgetButtonDurationMs(appSettings.forgetButtonDurationPreference));
  let isForgetHoldEnabled = $derived(forgetHoldDurationMs > 0);
  const visibleSearchResults = $derived.by<SearchItem[]>(() =>
    searchMode === 'current' ? dedupeCurrentSearchResults(searchResults) : searchResults
  );
  const visibleItems = $derived.by<NotepadCommandBarVisibleItem[]>(() =>
    searchMode === 'all' && (searchQuery.trim() !== '' || imageQueryUrl)
      ? rankMediaResults(visibleSearchResults, imageResults).map(item => item.kind === 'image'
          ? { kind: 'image' as const, item }
          : { kind: 'search' as const, item })
      : searchQuery.trim() === '' && browseMode === 'edited'
        ? [...pinnedNotes.map(item => ({ kind: 'pinned' as const, item })),
            ...lastEditedNotes.map(item => ({ kind: 'search' as const, item }))]
        : deriveNotepadCommandBarVisibleItems(searchQuery, visibleSearchResults, pinnedNotes, recentLocations)
  );
  // The store owns compatible results and request admission. This snapshot
  // only keeps the previous presentation steady during typing and retrieval.
  const searchPresentationContext = $derived(JSON.stringify([searchMode, imageQueryUrl]));
  const retainedSearchItems = $derived(panelOpen && !relatedMode
    && resultPreview?.context === searchPresentationContext ? resultPreview.items : null);
  const displayedItems = $derived(retainedSearchItems ?? visibleItems);
  const displayedQuery = $derived(retainedSearchItems !== null ? resultPreview!.query : searchQuery);
  const presentationPending = $derived(isSearching || !presentationQuiet);
  const presentedSearchError = $derived(presentationQuiet ? search.searchError : null);
  const presentedMediaError = $derived(presentationQuiet ? search.mediaError : null);
  $effect(() => {
    const context = searchPresentationContext;
    const open = panelOpen && !relatedMode;
    const pending = presentationPending;
    const failed = search.searchError || search.mediaError;
    const available = visibleItems.length > 0;
    const hasQuery = searchQuery.trim() !== '' || imageQueryUrl !== null;
    untrack(() => {
      if (!open || resultPreview?.context !== context || !hasQuery) clearPresentation();
      // A failed replacement keeps the old preview with Retry. Available results
      // from a successful channel remain usable even when the other channel fails.
      else if (!pending && (!failed || available || resultPreview?.items.length === 0)) resultPreview = null;
    });
  });
  const hasRecentContent = $derived(pinnedNotes.length > 0 || (browseMode === 'edited' ? lastEditedNotes.length > 0 : recentLocations.length > 0));
  const hasVisibleSearchContent = $derived(
    displayedQuery.trim() === '' && !imageQueryUrl ? hasRecentContent : displayedItems.length > 0
  );
  const canNavigateCurrentSearchResults = $derived(
    retainedSearchItems === null && searchMode === 'current' && searchQuery.trim() !== '' && searchResults.length > 0
  );

  const commandBarState = createNotepadCommandBarState({
    getSearchQuery: () => imageQueryUrl ? "image query" : searchQuery,
    getSearchMode: () => searchMode,
    getSearchResults: () => retainedSearchItems ? [] : visibleSearchResults,
    getSearchNavigationResults: () => retainedSearchItems ? [] : (searchMode === 'current' ? searchResults : visibleSearchResults),
    getSearchResultRowIndex: (result) => visibleSearchResults.findIndex(item =>
      searchMode === 'current'
        ? getCurrentSearchResultKey(item) === getCurrentSearchResultKey(result)
        : item === result),
    getPinnedNotes: () => pinnedNotes,
    getRecentLocations: () => recentLocations,
    getVisibleItems: () => retainedSearchItems ? [] : visibleItems,
    getForgetHoldDurationMs: () => forgetHoldDurationMs,
    isForgetHoldEnabled: () => isForgetHoldEnabled,
    isForgetActionAvailable: () => canForget && !canUnforget,
    getForgetItemLabel: () => forgetItemLabel,
    onSearchInput: (value) => onSearchInput(value),
    onSearchClear,
    onSearchSelect: (result) => onSearchSelect(result),
    getOpenInSplit: () => search.onOpenInSplit,
    onBrowseModeFocus: focusBrowseMode,
    onSplitActionFocus: (index) => focusResultAction(index, true),
    onImageSelect: (result) => { void search.onImageSelect?.(result); },
    onSearchNavigate: (result) => onSearchNavigate?.(result),
    onPinnedNoteSelect: (result) => onPinnedNoteSelect(result),
    onRecentLocationSelect: (entry) => onRecentLocationSelect(entry),
    onRecentLocationShortcut: (index) => onRecentLocationShortcut(index),
    closeSearch: () => searchBar?.closeSearch(),
    onSearchDismiss: () => onSearchDismiss?.(),
    onSearchCommit: () => onSearchCommit?.(),
    onCommand: (command) => onCommand?.(command) ?? false,
    onForget: () => onForget()
  });

  // Track only the materially distinguishing fingerprint of the visible
  // items so transient writable-store flips (e.g. isSearching toggling on a
  // keystroke that hasn't changed results yet) do not reset activeIndex.
  const visibleItemsFingerprint = $derived(
    JSON.stringify(visibleItems.map(entry => entry.kind === 'location'
      ? [entry.kind, entry.item.location, entry.item.label]
      : entry.kind === 'image'
        ? [entry.kind, entry.item.notePath, entry.item.sourceStart, entry.item.assetHash]
        : [entry.kind, entry.item.notePath, entry.item.sectionLabel, entry.item.matchText]))
  );

  const currentSearchRangesFingerprint = $derived(searchMode === 'current'
    ? JSON.stringify(searchResults.map(item => item.currentMatchRange)) : '');

  $effect(() => {
    visibleItemsFingerprint;
    searchMode;
    searchQuery;
    // Occurrences may change while the grouped row text stays the same.
    currentSearchRangesFingerprint;
    if (!retainedSearchItems) commandBarState.resetActiveIndex();
  });

  $effect(() => {
    canUnforget;
    if (canUnforget) {
      commandBarState.resetForgetHold();
    }
  });

  $effect(() => {
    canForget;
    forgetItemLabel;
    // Reset when the action changes, without subscribing to the dialog state
    // read by closeForgetConfirm and closing it again as soon as it opens.
    untrack(() => {
      commandBarState.closeForgetConfirm();
      commandBarState.resetForgetHold();
    });
  });

  $effect(() => {
    appSettings.forgetButtonDurationPreference;
    commandBarState.resetForgetHold();
  });

  $effect(() => {
    if (!commandBarState.isForgetConfirmOpen) {
      return;
    }

    void tick().then(() => {
      forgetCancelButton?.focus();
    });
  });

  $effect(() => {
    commandBarState.activeIndex;
    visibleItems;
    if (!retainedSearchItems) void commandBarState.syncActiveItemIntoView();
  });

  $effect(() => {
    commandBarState.bindSearchResultsViewport(searchResultsViewport);
  });

  $effect(() => {
    if (chatAvailable && dockMode === 'chat') searchBar?.closeSearch();
  });

  function handleSharedSearchOpen() {
    onDockModeChange?.('search');
    commandBarState.resetActiveIndex();
    onSearchOpen();
    if (browseMode === 'edited') void search.onLoadLastEdited?.();
  }

  function handleSharedSearchModeChange(mode: string) {
    if (mode !== 'current' && mode !== 'all') return;
    clearPresentation();
    return onSearchModeChange(mode);
  }

  onDestroy(() => {
    commandBarState.dispose();
  });

  function locationHistoryKey(item: LocationHistoryEntry, index: number) {
    if (item.location.kind === 'chat') {
      return `chat-${item.location.conversationId ?? 'slot'}`;
    }
    return `note-${item.location.notePath ?? item.location.noteId ?? 'current'}-${index}`;
  }

  function getSearchResultItemClass(mode: 'current' | 'all') {
    return mode === 'current'
      ? 'search-result-item grid min-h-10 min-w-0 w-full grid-cols-[minmax(0,1fr)_max-content] items-center gap-3 rounded-[0.9rem] px-3 py-2 text-left transition-colors'
      : 'search-result-item flex min-w-0 w-full flex-col gap-2 rounded-[1.1rem] px-4 py-3 text-left transition-colors';
  }

  function getSearchResultTitleClass() {
    return 'menu-label block truncate text-popover-foreground';
  }

  function getSearchResultHeaderClass() {
    return 'flex w-full min-w-0 items-start justify-between gap-3';
  }

  function getExcerptClass() {
    return 'menu-preview line-clamp-3 text-muted-foreground';
  }

  function getCurrentSearchLocationLabel(item: SearchItem) {
    if (item.sectionLabel === 'Title') {
      return 'Title';
    }

    if (item.startLine !== null) {
      return `Line ${item.startLine}`;
    }

    return item.sectionLabel;
  }

  function getCurrentSearchPreviewText(item: SearchItem, query = searchQuery) {
    const normalizedQuery = normalizeSearchText(query.trim());
    const excerpt = item.excerpt.trim();

    if (normalizedQuery === '' || normalizeSearchText(excerpt).includes(normalizedQuery)) {
      return excerpt;
    }

    return item.matchText.trim() || excerpt;
  }

  function getCurrentSearchPreviewSegments(item: SearchItem) {
    const previewText = getCurrentSearchPreviewText(item, displayedQuery);
    const trimmedQuery = displayedQuery.trim();

    if (previewText === item.excerpt.trim() && item.highlightRanges.length > 0) {
      return buildHighlightedSegments(...cropTextAroundRanges(item.excerpt, item.highlightRanges, 130, 24));
    }

    if (trimmedQuery === '') {
      return [{ text: previewText, highlighted: false }];
    }

    const previewLower = normalizeSearchText(previewText);
    const queryLower = normalizeSearchText(trimmedQuery);
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = previewLower.indexOf(queryLower);

    while (cursor !== -1) {
      const end = cursor + trimmedQuery.length;
      if (!matchWholeWord || isWholeWordSearchMatch(previewText, cursor, end)) {
        ranges.push({ start: cursor, end });
      }
      cursor = previewLower.indexOf(queryLower, cursor + trimmedQuery.length);
    }

    return buildHighlightedSegments(previewText, ranges);
  }

  function normalizeSearchText(text: string) {
    return matchCase ? text : text.toLowerCase();
  }

  function isWholeWordSearchMatch(text: string, from: number, to: number) {
    const before = from > 0 ? text[from - 1] : '';
    const after = to < text.length ? text[to] : '';
    return !/\p{L}|\p{N}|_/u.test(before) && !/\p{L}|\p{N}|_/u.test(after);
  }

  function dedupeCurrentSearchResults(results: SearchItem[]) {
    const seen = new Set<string>();
    return results.filter((item) => {
      const key = getCurrentSearchResultKey(item);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function getCurrentSearchResultKey(item: SearchItem) {
    const [previewText] = getCurrentSearchPreviewCrop(item);
    return `${item.sectionLabel}|${previewText}`;
  }

  function getCurrentSearchPreviewCrop(item: SearchItem) {
    const previewText = getCurrentSearchPreviewText(item);
    if (previewText === item.excerpt.trim() && item.highlightRanges.length > 0) {
      return cropTextAroundRanges(item.excerpt, item.highlightRanges, 130, 24);
    }
    return [previewText, []] as [string, Array<{ start: number; end: number }>];
  }

  function cropTextAroundRanges(
    text: string,
    ranges: Array<{ start: number; end: number }>,
    maxChars: number,
    leadingContextChars: number
  ): [string, Array<{ start: number; end: number }>] {
    const characters = Array.from(text);
    const firstRange = ranges[0];

    if (!firstRange || characters.length <= maxChars) {
      return [text, ranges];
    }

    const rangeStart = Math.max(0, Math.min(firstRange.start, characters.length));
    const rangeEnd = Math.max(rangeStart, Math.min(firstRange.end, characters.length));
    let start = Math.max(0, rangeStart - leadingContextChars);
    let end = Math.min(characters.length, start + maxChars);

    if (rangeEnd > end) {
      end = Math.min(characters.length, rangeEnd + leadingContextChars);
      start = Math.max(0, end - maxChars);
    }

    const prefix = start > 0 ? '…' : '';
    const suffix = end < characters.length ? '…' : '';
    const cropped = `${prefix}${characters.slice(start, end).join('')}${suffix}`;
    const prefixLength = prefix.length;
    const adjustedRanges = ranges
      .filter((range) => range.end > start && range.start < end)
      .map((range) => ({
        start: Math.max(0, range.start - start) + prefixLength,
        end: Math.min(end, range.end) - start + prefixLength
      }));

    return [cropped, adjustedRanges];
  }

  function handleRemember() {
    onRemember();
  }

  function closeForgetConfirm(restoreFocusToForgetButton = false) {
    commandBarState.closeForgetConfirm();
    void tick().then(() => {
      if (restoreFocusToForgetButton) {
        forgetButton?.focus();
        return;
      }

      forgetButton?.blur();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
  }

  function handleForgetConfirmKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    closeForgetConfirm();
  }
</script>

<svelte:window
  onkeydowncapture={handleWindowKeydown}
  onkeyupcapture={commandBarState.handleForgetShortcutKeyUp}
  onblur={commandBarState.handleForgetShortcutBlur}
/>

<div
  data-notepad-command-bar
  class="pointer-events-auto relative min-w-0 overflow-visible rounded-none shadow-none sm:rounded-2xl sm:shadow-lg"
>
  <div
    class="absolute inset-0 rounded-none bg-card/58 backdrop-blur-sm sm:rounded-2xl"
    style="mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
  ></div>
  <div class="search-dock-row notepad-command-bar-content relative z-10 flex min-w-0 items-center justify-between gap-1.5 px-2.5 sm:gap-4 sm:px-6"
    class:notepad-command-bar-content--chat={chatAvailable}>
    <div
      class={`relative inline-flex shrink-0 items-center rounded-full border p-1 shadow-sm ${
        canUnforget ? 'bg-secondary text-secondary-foreground' : 'bg-background text-muted-foreground'
      } ${commandBarState.isHoldingForget ? 'border-destructive/70' : 'border-border'}`}
    >
      {#if canUnforget}
        <button
          type="button"
          class="notepad-command-action mobile-touch-target inline-flex h-8 w-8 items-center justify-center rounded-full p-0 font-medium transition-colors hover:bg-accent sm:h-11 sm:w-auto sm:min-w-[126px] sm:px-5"
          onclick={() => onUnforget()}
          aria-label={`Restore the last forgotten ${forgetItemLabel}`}
          title={`Restore forgotten ${forgetItemLabel}`}
        >
          <span class="notepad-command-action-label hidden sm:inline">unForget</span>
          <Undo2 class="h-5 w-5 sm:hidden" />
        </button>
      {:else}
        {#if commandBarState.isForgetConfirmOpen}
          <div
            id="forget-confirm-popover"
            class="absolute bottom-[calc(100%+0.75rem)] left-0 z-40 w-[min(18rem,calc(100vw-1.5rem))] rounded-[1.2rem] border border-border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur-md"
            role="dialog"
            aria-modal="false"
            aria-labelledby="forget-confirm-title"
            aria-describedby="forget-confirm-description"
            tabindex="-1"
            onkeydown={handleForgetConfirmKeydown}
          >
            <div class="flex items-start gap-3">
              <div class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/12 text-destructive">
                <Eraser class="h-4 w-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p id="forget-confirm-title" class="menu-label">Forget this {forgetItemLabel}?</p>
                <p id="forget-confirm-description" class="menu-preview mt-1 text-muted-foreground">
                  You can also hold Forget (or its shortcut) to skip this confirmation.
                </p>
              </div>
            </div>
            <div class="mt-3 flex justify-end gap-2">
              <button
                bind:this={forgetCancelButton}
                type="button"
                class="inline-flex h-8 items-center rounded-full px-3 menu-label text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onclick={() => closeForgetConfirm(true)}
                title="Keep this note"
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center rounded-full bg-destructive px-3 menu-label text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
                onclick={commandBarState.confirmForget}
                title={`Forget this ${forgetItemLabel}`}
              >
                Forget
              </button>
            </div>
          </div>
        {/if}
        <button
          bind:this={forgetButton}
          type="button"
          disabled={!canForget}
          aria-expanded={commandBarState.isForgetConfirmOpen}
          aria-controls={commandBarState.isForgetConfirmOpen ? 'forget-confirm-popover' : undefined}
          class={`notepad-command-action mobile-touch-target relative isolate inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full p-0 font-medium transition-colors hover:bg-destructive/20 hover:text-destructive active:bg-destructive/15 active:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit sm:h-11 sm:w-auto sm:min-w-[126px] sm:px-5 ${
            commandBarState.isHoldingForget
              ? 'forget-hold-animation text-destructive'
              : ''
          }`}
          style={`--forget-progress: ${commandBarState.forgetHoldProgress};`}
          aria-label={commandBarState.getForgetButtonAriaLabel()}
          title={commandBarState.getForgetButtonAriaLabel()}
          onclick={commandBarState.handleForgetClick}
          onpointerdown={commandBarState.handleForgetPointerDown}
          onpointerup={commandBarState.cancelForgetHold}
          onpointerleave={commandBarState.cancelForgetHold}
          onpointercancel={commandBarState.cancelForgetHold}
          onkeydown={commandBarState.handleForgetKeyDown}
          onkeyup={commandBarState.handleForgetKeyUp}
        >
          <span
            class="absolute inset-0 z-0 origin-left rounded-[inherit] bg-destructive/55"
            style="transform: scaleX(var(--forget-progress, 0)); opacity: calc(0.14 + (var(--forget-progress, 0) * 0.58));"
            aria-hidden="true"
          ></span>
          <span class="notepad-command-action-label relative z-10 hidden sm:inline">
            Forget
          </span>
          <Eraser
            class={`relative z-10 h-5 w-5 transition-transform duration-200 sm:hidden ${
              commandBarState.isHoldingForget ? '-translate-y-px' : ''
            }`}
          />
        </button>
      {/if}
    </div>

    {#snippet relatedInput()}
      <div class="related-search-heading flex w-full min-w-0 items-center" role="group" aria-label="Related note controls">
        <button bind:this={relatedHeader} onkeydown={handleRelatedKeydown} type="button" class="min-w-0 flex-1 truncate rounded py-1.5 text-left text-base text-foreground outline-none min-[700px]:text-sm sm:py-2" aria-label={`${relatedView === 'backlinks' ? 'Backlinks to' : 'Related to'} ${related?.title || 'this note'}`}>
          {relatedView === 'backlinks' ? 'Backlinks to' : 'Related to'} {related?.title || 'this note'}
        </button>
      </div>
    {/snippet}

    {#snippet searchPanel()}
        <SearchResultsPanel navigationMode={commandBarState.searchNavigationMode} busy={presentationPending && !relatedMode} onkeydown={handleSearchResultsKeydown}>
          {#if relatedMode}
            <div id={relatedPopupId} class="min-h-0 flex-1 overflow-y-auto" onkeydown={handleRelatedKeydown} role="dialog" tabindex="-1" aria-label={relatedView === 'backlinks' ? 'Backlinks' : 'Related notes'}>
              <div class="flex justify-center px-3 pb-1 pt-2">
                <div bind:this={relatedControls} class="inline-flex gap-1 rounded-full border border-border/80 bg-muted/40 p-1" role="group" aria-label="Note connections">
                  {#each [{ id: 'related', label: 'Related' }, { id: 'backlinks', label: 'Backlinks' }] as choice}
                    <button type="button" aria-pressed={relatedView === choice.id}
                      data-related-view={choice.id} data-search-focus-independent
                      onkeydown={handleRelatedViewKeydown}
                      class={`menu-label rounded-full border px-4 py-1.5 transition-colors ${relatedView === choice.id ? 'border-foreground/15 bg-card text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                      onmousedown={(event) => event.preventDefault()}
                      onclick={() => selectRelatedView(choice.id as RelatedView)}>{choice.label}</button>
                  {/each}
                </div>
              </div>
              <RelatedResults view={relatedView} result={related?.result ?? null} activeIndex={relatedIndex} onSelect={selectRelated} onPoint={(index) => relatedIndex = index} onRefresh={() => related?.onRefresh()}
                onOpenInSplit={related?.onOpenInSplit ? (item) => chooseSplit(() => related?.onOpenInSplit?.(item)) : undefined} />
            </div>
          {:else}
          {#if searchMode === 'all' && (searchQuery.trim() !== '' || imageQueryUrl) && search.onResultTypeChange && search.onEditedWindowChange}
            <div class="search-retrieval-cues flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pb-2 pt-1">
              <div class="flex items-center gap-1" role="group" aria-label="Result type">
                {#each resultTypeChoices as choice}
                  <button type="button" data-search-focus-independent data-search-result-type={choice.id}
                    class="search-retrieval-cue rounded-full border px-3 py-1 menu-heading transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Show ${choice.id === 'all' ? 'all result types' : choice.id}`}
                    aria-pressed={resultType === choice.id}
                    onkeydown={handleSearchCueKeydown}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => changeResultType(choice.id)}>{choice.label}</button>
                {/each}
              </div>
              <div class="search-retrieval-edited flex flex-wrap items-center gap-1" role="group" aria-label="Edited">
                <span class="menu-caption search-edited-label mr-1 text-muted-foreground">Edited</span>
                {#each editedWindowChoices as choice}
                  <button type="button" data-search-focus-independent data-search-edited-window={choice.id}
                    class="search-retrieval-cue rounded-full border px-3 py-1 menu-heading transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={choice.description} title={choice.id === 'any' ? choice.description : `${choice.description}, by file modification time`}
                    aria-pressed={editedWindow === choice.id}
                    onkeydown={handleSearchCueKeydown}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => changeEditedWindow(choice.id)}>{choice.label}</button>
                {/each}
              </div>
            </div>
          {/if}
          {#if presentedSearchError || presentedMediaError}
            <div class="flex items-center justify-between menu-caption gap-2 px-4 py-2 text-muted-foreground" role="status">
              <span>{presentedSearchError ?? presentedMediaError}{#if retainedSearchItems}{' '}Previous matches shown. Retry to update results.{:else if visibleItems.length > 0}{' '}Showing available matches.{/if}</span>
              {#if search.onSearchRetry}
                <button type="button" class="menu-heading rounded px-2 py-1 text-foreground hover:bg-accent disabled:opacity-50" data-search-focus-independent disabled={isSearching} onclick={() => void search.onSearchRetry?.()}>Retry</button>
              {/if}
            </div>
          {/if}
          {#if presentationPending}
            <span class="sr-only" role="status">{retainedSearchItems !== null ? 'Updating search results…' : 'Searching notes…'}</span>
          {/if}
          {#if searchQuery.trim() === '' && !imageQueryUrl}
            <div class="flex justify-center px-3 pb-1 pt-2">
              <div bind:this={browseControls} class="inline-flex gap-1 rounded-full border border-border/80 bg-muted/40 p-1" role="group" aria-label="Browse notes">
                {#each [{ id: 'recent', label: 'Recent' }, { id: 'edited', label: 'Last edited' }] as choice}
                  <button type="button" aria-pressed={browseMode === choice.id}
                    data-browse-mode={choice.id}
                    onkeydown={handleBrowseModeKeydown}
                    class={`menu-label rounded-full border px-4 py-1.5 transition-colors ${browseMode === choice.id ? 'border-foreground/15 bg-card text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                    data-search-focus-independent
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => selectBrowseMode(choice.id as 'recent' | 'edited')}>{choice.label}</button>
                {/each}
              </div>
            </div>
            {#if browseMode === 'edited' && search.lastEditedError}
              <div class="flex items-center justify-between menu-caption gap-2 px-4 py-2 text-muted-foreground" role="status">
                <span>{search.lastEditedError}</span>
                <button type="button" class="menu-heading rounded px-2 py-1 text-foreground hover:bg-accent" data-search-focus-independent onclick={() => void search.onLoadLastEdited?.()}>Retry</button>
              </div>
            {/if}
          {/if}
          <div class="search-results-content" inert={retainedSearchItems !== null} data-search-presentation-query={displayedQuery}>
          {#if presentationPending && retainedSearchItems === null && displayedItems.length === 0 && (displayedQuery.trim() !== '' || imageQueryUrl)}
            <div class="min-h-0 flex-1"></div>
          {:else if imageQueryUrl && displayedItems.length === 0 && !presentedMediaError}
            {#if !presentationPending}<p class="menu-caption px-3 py-2 text-muted-foreground">{resultType !== 'all' || editedWindow !== 'any' ? 'No matches with these filters. Try All or Any time.' : 'No matching images or text passages yet.'}</p>{/if}
          {:else if displayedQuery.trim() === '' && !imageQueryUrl && browseMode === 'edited' && search.isLoadingLastEdited && lastEditedNotes.length === 0}
            <div class="menu-caption px-4 py-3 text-muted-foreground" role="status">Loading last edited notes…</div>
          {:else if !hasVisibleSearchContent && !presentedSearchError && !presentedMediaError}
            <div class="menu-caption px-4 py-3 text-muted-foreground">
              {#if displayedQuery.trim() === ''}
                {browseMode === 'edited' ? 'No saved notes yet.' : `Start typing to search ${searchMode === 'current' ? 'this note' : 'all notes'}.`}
              {:else if searchMode === 'all' && (resultType !== 'all' || editedWindow !== 'any')}
                No matches with these filters. Try All or Any time.
              {:else}
                No matches in {searchMode === 'current' ? 'this note' : 'all notes'}. Try {searchMode === 'current' ? 'All notes' : 'This note'}.
              {/if}
            </div>
          {:else if displayedQuery.trim() === '' && !imageQueryUrl}
            <!-- Stacked sections share a viewport so short windows can show whole
                 rows. Desktop columns each scroll within the full remaining height. -->
            <div
              bind:this={searchResultsViewport}
              class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain lg:flex-row lg:items-stretch lg:gap-0 lg:overflow-visible"
            >
              {#if pinnedNotes.length > 0}
                <section
                  class={`flex min-w-0 flex-1 flex-col lg:order-2 lg:min-h-0 ${
                    (browseMode === 'edited' ? lastEditedNotes.length : recentLocations.length) > 0
                      ? 'border-b border-border/70 pb-2 lg:border-b-0 lg:border-l lg:border-border/70 lg:pb-0 lg:pl-3'
                      : ''
                  }`}
                >
                  <SearchResultsHeading title="Pinned" />
                  <div class="flex-1 overscroll-contain lg:min-h-0 lg:overflow-y-auto">
                    {#each pinnedNotes as item, index (`pinned-${item.noteId ?? item.notePath}-${index}`)}
                      <div class="group flex items-center gap-1">
                        <SearchNoteResult title={noteFileLabel(item.fileName, item.noteId)} label={`Open pinned note: ${noteFileLabel(item.fileName, item.noteId)}`}
                          onOpenInSplit={search.onOpenInSplit && hasSplitDiscoveryDestination(item) ? () => commandBarState.openItemInSplit({ kind: 'pinned', item }) : undefined}
                          active={index === commandBarState.activeIndex} resultIndex={index}
                          onFocus={() => commandBarState.handleSearchItemFocus(index)}
                          onPoint={() => commandBarState.handleSearchItemPointerEnter(index)}
                          onSelect={() => commandBarState.selectItem({ kind: 'pinned', item })}>
                          {#snippet icon()}<Pin class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{/snippet}
                        </SearchNoteResult>
                        <button
                          type="button"
                          class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                          aria-label={`Unpin ${noteFileLabel(item.fileName, item.noteId)}`}
                          title={`Unpin ${noteFileLabel(item.fileName, item.noteId)}`}
                          data-search-focus-independent
                          onmousedown={(event) => event.preventDefault()}
                          onclick={() => item.noteId && void onSetNotePinned(item.noteId, false)}
                        >
                          <PinOff class="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/each}
                  </div>
                </section>
              {/if}

              {#if browseMode === 'edited' && lastEditedNotes.length > 0}
                <section class="flex min-w-0 flex-1 flex-col lg:order-1 lg:min-h-0 lg:pr-3">
                  <SearchResultsHeading title="Last edited" />
                  <div class="flex-1 overscroll-contain lg:min-h-0 lg:overflow-y-auto">
                    {#each lastEditedNotes as item, index (`edited-${item.noteId ?? item.notePath}-${index}`)}
                      {@const globalIndex = pinnedNotes.length + index}
                      <SearchNoteResult title={noteFileLabel(item.fileName, item.noteId)} label={`Open last edited note: ${noteFileLabel(item.fileName, item.noteId)}`}
                        onOpenInSplit={search.onOpenInSplit && hasSplitDiscoveryDestination(item) ? () => commandBarState.openItemInSplit({ kind: 'search', item }) : undefined}
                        active={globalIndex === commandBarState.activeIndex} resultIndex={globalIndex}
                        onFocus={() => commandBarState.handleSearchItemFocus(globalIndex)}
                        onPoint={() => commandBarState.handleSearchItemPointerEnter(globalIndex)}
                        onSelect={() => commandBarState.selectItem({ kind: 'search', item })} />
                    {/each}
                  </div>
                </section>
              {:else if browseMode === 'recent' && recentLocations.length > 0}
                <section class="flex min-w-0 flex-1 flex-col lg:order-1 lg:min-h-0 lg:pr-3">
                  <SearchResultsHeading title="Recent" />
                  <div class="flex-1 overscroll-contain lg:min-h-0 lg:overflow-y-auto">
                    {#each recentLocations as item, index (locationHistoryKey(item, index))}
                      {@const globalIndex = pinnedNotes.length + index}
                      <SearchNoteResult title={item.label}
                        onOpenInSplit={search.onOpenInSplit && hasSplitDiscoveryDestination(item) ? () => commandBarState.openItemInSplit({ kind: 'location', item }) : undefined}
                        label={`Open recent ${item.location.kind === 'chat' ? 'thought partner' : 'note'}: ${item.label}`}
                        active={globalIndex === commandBarState.activeIndex} resultIndex={globalIndex}
                        onFocus={() => commandBarState.handleSearchItemFocus(globalIndex)}
                        onPoint={() => commandBarState.handleSearchItemPointerEnter(globalIndex)}
                        onSelect={() => commandBarState.selectItem({ kind: 'location', item })}>
                        {#snippet icon()}{#if item.location.kind === 'chat'}<MessagesSquare class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{/if}{/snippet}
                      </SearchNoteResult>
                    {/each}
                  </div>
                </section>
              {/if}
            </div>
          {:else}
            <div bind:this={searchResultsViewport} class="min-h-0 flex-1 overflow-y-auto" inert={retainedSearchItems !== null} data-search-retained={retainedSearchItems !== null}>
              {#each displayedItems as entry, index (index)}
                {#if entry.kind === 'image'}
                  <div data-search-result-index={index}>
                  <ImageSearchResult item={entry.item} load={loadThumbnail}
                    active={index === commandBarState.activeIndex}
                    onFocus={() => commandBarState.handleSearchItemFocus(index)}
                    onPointerEnter={() => commandBarState.handleSearchItemPointerEnter(index)}
                    onSelect={() => commandBarState.selectItem(entry)} />
                  </div>
                {:else if entry.kind === 'search'}
                {@const item = entry.item}
                <div class="flex min-w-0 items-center gap-1" data-search-result-index={index} data-search-result-row>
                <button
                  type="button"
                  data-search-result-active={index === commandBarState.activeIndex ? 'true' : 'false'}
                  class={getSearchResultItemClass(searchMode)}
                  class:bg-accent={index === commandBarState.activeIndex}
                  aria-label={`Open search result: ${searchMode !== 'current' ? noteFileLabel(item.fileName, item.noteId) : item.sectionLabel}`}
                  title={searchMode !== 'current' ? noteFileLabel(item.fileName, item.noteId) : item.sectionLabel}
                  onmousedown={(event) => event.preventDefault()}
                  onpointerenter={() => commandBarState.handleSearchItemPointerEnter(index)}
                  onfocus={() => commandBarState.handleSearchItemFocus(index)}
                  onclick={(event) => commandBarState.selectItem({ kind: 'search', item }, event)}
                >
                  {#if searchMode === 'current'}
                    <p class="menu-preview min-w-0 truncate text-muted-foreground">
                      {#each getCurrentSearchPreviewSegments(item) as segment, segmentIndex (`${segment.text}-${segment.highlighted}-${segmentIndex}`)}
                        {#if segment.highlighted}
                          <mark class="rounded-[0.3rem] bg-accent px-[0.1rem] text-foreground">{segment.text}</mark>
                        {:else}
                          <span>{segment.text}</span>
                        {/if}
                      {/each}
                    </p>
                    <span class="menu-heading min-w-0 max-w-36 truncate text-right text-popover-foreground">
                      {getCurrentSearchLocationLabel(item)}
                    </span>
                  {:else}
                    <div class={getSearchResultHeaderClass()}>
                      <div class="min-w-0 flex-1">
                        <span class={getSearchResultTitleClass()}>
                          {noteFileLabel(item.fileName, item.noteId)}
                        </span>
                        {#if item.reasonLabels && item.reasonLabels.length > 0}
                          <div class="mt-1 flex flex-wrap gap-1.5">
                            {#each item.reasonLabels as label, labelIndex (`${label}-${labelIndex}`)}
                              <span class="menu-caption rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                                {label}
                              </span>
                            {/each}
                          </div>
                        {/if}
                      </div>
                      {#if item.sectionLabel !== 'Title'}
                        <span class="menu-caption min-w-0 max-w-[45%] truncate text-muted-foreground" title={item.sectionLabel}>
                          {item.sectionLabel}
                        </span>
                      {/if}
                    </div>
                    <p class={getExcerptClass()}>
                      {#each buildHighlightedSegments(item.excerpt, item.highlightRanges) as segment, segmentIndex (`${segment.text}-${segment.highlighted}-${segmentIndex}`)}
                        {#if segment.highlighted}
                          <mark class="rounded-[0.35rem] bg-accent px-[0.1rem] text-foreground">{segment.text}</mark>
                        {:else}
                          <span>{segment.text}</span>
                        {/if}
                      {/each}
                    </p>
                  {/if}
                </button>
                {#if search.onOpenInSplit && hasSplitDiscoveryDestination(item)}
                  <SplitSearchResultAction title={noteFileLabel(item.fileName, item.noteId)} onFocus={() => commandBarState.handleSearchItemFocus(index)} onSelect={() => commandBarState.openItemInSplit({ kind: 'search', item })} />
                {/if}
                </div>
                {/if}
              {/each}
            </div>
          {/if}
          </div>
          {/if}
        </SearchResultsPanel>
    {/snippet}

    {#snippet imageQueryPreview()}
      <img src={imageQueryUrl} alt="Search query"
        class="h-8 w-10 shrink-0 rounded-md border border-border/60 bg-card object-cover" />
    {/snippet}

    {#snippet dockPopup()}{#if panelOpen}{@render searchPanel()}{/if}{/snippet}

    <div class="notepad-discovery-dock flex min-w-0 flex-1 items-end gap-2 sm:gap-3">
    <WorkspaceInputDock
      hasChat={chatAvailable}
      related={related?.contextKey || related?.pendingNoteReturn ? {
        active: relatedMode, available: !!related.contextKey, popupId: relatedPopupId,
        onOpen: toggleRelated, onDismiss: () => closeRelated(true), onBlur: () => closeRelated()
      } : undefined}
      relatedContent={relatedInput}
      overlay={dockPopup}
      mode={dockMode}
      bind:chatSlot
      bind:actionPresentation
      onSearch={() => searchBar?.focusSearch()}
      onChat={() => onExpandChat?.()}
    >
      {#snippet search(presentation, focusBoundary)}
        <SearchBar
          class="notepad-search-bar"
          {focusBoundary}
          bind:this={searchBar}
          value={searchQuery}
          expanded={chatAvailable && dockMode === 'search' ? true : undefined}
          presentationActive={presentation.active}
          presentationExpanded={presentation.expanded}
          presentationInputOpacity={presentation.inputOpacity}
          hasQuery={imageQueryUrl !== null}
          placeholder={imageQueryUrl ? 'Add text to refine this image' : searchMode === 'current' ? 'Search this note' : 'Search all notes'}
          ariaLabel={`${searchScopeTitle}. ${searchMode === 'current' ? 'Search this note' : 'Search the selected scope'}`}
          testId="note-search-input"
          matchCase={matchCase}
          matchWholeWord={matchWholeWord}
          showMatchOptions={true}
          scopeId={searchMode}
          scopeOptions={searchScopeOptions}
          canNavigatePrevious={searchMode === 'current' && canNavigateCurrentSearchResults}
          canNavigateNext={searchMode === 'current' && canNavigateCurrentSearchResults}
          blurOnEscape={false}
          shortcut={{ enabled: true, defaultScopeId: 'current', allScopeId: 'all' }}
          onValueChange={onSearchInput}
          onClear={onSearchClear}
          onOpen={handleSharedSearchOpen}
          onOpenChange={(open) => panelOpen = open}
          onScopeChange={handleSharedSearchModeChange}
          onMatchCaseChange={onMatchCaseChange}
          onMatchWholeWordChange={onMatchWholeWordChange}
          onNavigate={searchMode === 'current' ? (delta) => commandBarState.navigateSearchResult(delta) : undefined}
          onInputKeydown={commandBarState.handleSearchKeydown}
          onImageFile={searchMode === 'all' ? chooseImage : undefined}
          queryPreview={imageQueryUrl ? imageQueryPreview : undefined}
          onSearchIntent={showSearch}
          onClose={() => { if (relatedMode) { relatedMode = false; related?.onClose(); } }}
        />
      {/snippet}
    </WorkspaceInputDock>
    </div>


    <div
      class="inline-flex shrink-0 items-center rounded-full border border-border bg-background p-1 text-muted-foreground shadow-sm"
    >
      <button
        class="notepad-command-action mobile-touch-target inline-flex h-8 w-8 items-center justify-center rounded-full p-0 font-medium transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 sm:h-11 sm:w-auto sm:min-w-[126px] sm:px-5"
        type="button"
        onclick={handleRemember}
        disabled={actionPresentation.running && outgoingRememberLabel !== null && actionPresentation.progress < 0.45}
        aria-label={rememberAriaLabel}
        title={rememberLabel}
      >
        <span class="notepad-command-action-label remember-action-label hidden sm:inline">
          <span>{rememberLabelPrefix}</span><span class="remember-action-name">
            {#if rememberLabelPrefix}<span class="remember-action-size" aria-hidden="true">Chat</span>{/if}
            <span class="remember-action-current" style:opacity={actionPresentation.running && outgoingRememberLabel ? dockRamp(0.45, 0.8, actionPresentation.progress) : 1}>{rememberLabel.slice(rememberLabelPrefix.length)}</span>
            {#if actionPresentation.running && outgoingRememberLabel}
              <span class="remember-action-outgoing" aria-hidden="true" style:opacity={1 - dockRamp(0.1, 0.35, actionPresentation.progress)}>{outgoingRememberLabel.slice(rememberLabelPrefix.length)}</span>
            {/if}
          </span>
        </span>
        <SquarePen class="h-5 w-5 sm:hidden" />
      </button>
    </div>
  </div>
</div>

<style>
  .search-results-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }

  .search-retrieval-cues { container-type: inline-size; flex-shrink: 0; }
  .search-retrieval-cue {
    min-height: 2.25rem;
    min-width: 2.75rem;
    white-space: nowrap;
    border-color: transparent;
    color: var(--muted-foreground);
    background: color-mix(in oklab, var(--muted) 45%, transparent);
  }
  .search-retrieval-cue[aria-pressed='true'] {
    border-color: color-mix(in oklab, var(--foreground) 18%, transparent);
    color: var(--foreground);
    background: var(--card);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
  }
  @container (max-width: 18rem) {
    .search-edited-label { display: none; }
    .search-retrieval-edited { flex-wrap: nowrap; gap: 0.125rem; }
    .search-retrieval-cue { padding-inline: 0.375rem; }
  }
  @media (pointer: coarse) {
    .search-retrieval-cue { min-height: 2.75rem; }
  }
  .notepad-discovery-dock { --discovery-gap: 0.5rem; }
  .related-search-heading { padding-right: var(--search-bar-height); }
  @media (min-width: 640px) {
    .notepad-discovery-dock { --discovery-gap: 0.75rem; }
  }
  [data-notepad-command-bar] {
    container: note-toolbar / inline-size;
  }

  .notepad-command-bar-content {
    --workspace-dock-action-height: 3.375rem;
    --workspace-dock-circle-inset: calc((var(--workspace-dock-action-height) - var(--search-bar-height)) / 2);
    align-items: flex-end;
  }
  .notepad-command-bar-content > :global(:first-child) { transform: translateX(var(--dock-action-0-shift, 0px)); }
  .notepad-command-bar-content > :global(:last-child) { transform: translateX(var(--dock-action-1-shift, 0px)); }
  :global([data-pane-motion]) .notepad-command-bar-content {
    /* Pane motion positions the input absolutely. Keep its row and backdrop
       fitted to the live dock height rather than a captured layout endpoint. */
    height: calc(var(--dock-layout-body-height, var(--search-bar-height)) + var(--workspace-dock-circle-inset) + 2 * var(--search-dock-padding) + var(--search-dock-safe-area));
  }
  .remember-action-label { position: relative; }
  .remember-action-name { position: relative; display: inline-grid; }
  .remember-action-current, .remember-action-size { grid-area: 1 / 1; }
  .remember-action-size { visibility: hidden; }
  .remember-action-outgoing { position: absolute; inset: 0; white-space: nowrap; }

  @container note-toolbar (max-width: 56rem) {
    .notepad-command-action {
      /* Release the label's space continuously below the icon breakpoint.
       * An abrupt label collapse would make expanded search reverse during
       * pane transitions. */
      --command-action-extra: clamp(0px, calc((100cqw - 45.75rem) / 2), 5.125rem);
      width: calc(2.75rem + var(--command-action-extra));
      min-width: 2.75rem;
      padding-inline: 0;
    }

    .notepad-command-action-label {
      display: none;
    }

    .notepad-command-action :global(svg) {
      display: block;
    }
  }

  @keyframes forget-hold-pulse {
    from {
      box-shadow:
        0 0 0 1px rgb(248 113 113 / 0.12),
        0 8px 18px rgb(127 29 29 / 0.06);
    }

    to {
      box-shadow:
        0 0 0 1px rgb(248 113 113 / 0.28),
        0 10px 24px rgb(127 29 29 / 0.14);
    }
  }

  .forget-hold-animation {
    animation: forget-hold-pulse 0.95s ease-in-out infinite alternate;
  }

  @media (max-height: 559px) {
    .notepad-command-bar-content {
      gap: 0.375rem;
      padding-inline: 0.625rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .forget-hold-animation {
      animation: none;
    }
  }
  @media (any-pointer: coarse) and (orientation: landscape) {
    :global(.app-shell[data-keyboard-open='true']) .notepad-command-bar-content {
      --workspace-dock-action-height: 2.875rem;
      --workspace-dock-circle-inset: 0px;
      --search-dock-padding: 0px;
      min-height: 2.875rem;
      padding-block: 0;
    }
    :global(.app-shell[data-keyboard-open='true']) .notepad-command-bar-content > :global(:first-child),
    :global(.app-shell[data-keyboard-open='true']) .notepad-command-bar-content > :global(:last-child) { padding: 0; }
    :global(.app-shell[data-keyboard-open='true']) .notepad-command-bar-content :global(.workspace-input-dock) { --dock-circle-inset: 0px; }
  }
</style>
