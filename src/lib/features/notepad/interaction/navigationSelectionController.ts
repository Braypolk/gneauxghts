import { tick } from 'svelte';
import type {
  NavigationContext,
  NavigationContextSource,
  OpenContext
} from '$lib/features/notepad/navigation/openFlow';
import type { SearchMode } from '$lib/features/notepad/search/search';
import type { RecentTaskItem } from '$lib/features/notepad/model/types';
import type {
  RelatedNoteItem,
  SearchItem
} from '$lib/types/semantic';

export interface NavigationSelectionControllerDeps<
  TPaneId extends string
> {
  getSearchMode: () => SearchMode;
  resetPaneCommand: () => void;
  getActivePaneId: () => TPaneId;
  getNavigationPaneId: () => TPaneId;
  activatePane: (paneId: TPaneId) => void;
  focusSearchRange: (
    paneId: TPaneId,
    range: { from: number; to: number },
    options?: { focus?: boolean }
  ) => void;
  saveCursorPosition: () => void;
  getOpenContext: (paneId?: TPaneId) => OpenContext;
  getNavigationContext: (paneId?: TPaneId) => NavigationContext;
  openSearchResult: (
    openContext: OpenContext,
    navigationContext: NavigationContextSource,
    result: SearchItem
  ) => Promise<void>;
  openRecentTask: (
    openContext: OpenContext,
    navigationContext: NavigationContextSource,
    task: RecentTaskItem
  ) => Promise<void>;
  afterRender?: () => Promise<void>;
}

/**
 * Owns selection-to-navigation flows for search, recent tasks and related
 * notes. Reactive query/result state remains in the component stores.
 */
export function createNavigationSelectionController<
  TPaneId extends string
>(deps: NavigationSelectionControllerDeps<TPaneId>) {
  const afterRender = deps.afterRender ?? tick;
  function contextForSelection() {
    const paneId = deps.getActivePaneId();
    return {
      paneId,
      open: deps.getOpenContext(paneId),
      navigation: () => deps.getNavigationContext(paneId)
    };
  }

  async function handleSearchResultSelect(result: SearchItem) {
    deps.resetPaneCommand();
    const context = contextForSelection();
    if (
      deps.getSearchMode() === 'current' &&
      result.currentMatchRange && context.open.isEditorVisible !== false
    ) {
      const paneId = context.paneId;
      deps.activatePane(paneId);
      await afterRender();
      deps.focusSearchRange(
        paneId,
        result.currentMatchRange
      );
      deps.saveCursorPosition();
      return;
    }

    await deps.openSearchResult(
      // Choosing a search result keeps the query available for further matches.
      { ...context.open, clearSearch: () => {} },
      context.navigation,
      result
    );
    deps.saveCursorPosition();
  }

  async function handleSearchResultNavigate(
    result: SearchItem
  ) {
    if (
      deps.getSearchMode() !== 'current' ||
      !result.currentMatchRange
    ) {
      return;
    }

    deps.resetPaneCommand();
    const paneId = deps.getNavigationPaneId();
    deps.activatePane(paneId);
    await afterRender();
    // Browsing matches is a preview, not a commit: persisting each previewed
    // position would destroy the cursor the user wants to return to on Escape.
    deps.focusSearchRange(
      paneId,
      result.currentMatchRange,
      { focus: false }
    );
  }

  async function handleRecentTaskSelect(
    task: RecentTaskItem
  ) {
    deps.resetPaneCommand();
    const context = contextForSelection();
    await deps.openRecentTask(
      context.open,
      context.navigation,
      task
    );
    deps.saveCursorPosition();
  }

  async function handleRelatedItemSelect(
    item: RelatedNoteItem
  ) {
    deps.resetPaneCommand();
    const context = contextForSelection();
    await deps.openSearchResult(
      context.open,
      context.navigation,
      {
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
      }
    );
    deps.saveCursorPosition();
  }

  return {
    handleSearchResultSelect,
    handleSearchResultNavigate,
    handleRecentTaskSelect,
    handleRelatedItemSelect
  };
}
