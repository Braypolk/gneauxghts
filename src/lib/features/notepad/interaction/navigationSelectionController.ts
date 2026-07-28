import { tick } from 'svelte';
import type {
  NavigationContext,
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
  clearSearch: () => void;
  resetPaneCommand: () => void;
  getNavigationPaneId: () => TPaneId;
  activatePane: (paneId: TPaneId) => void;
  focusSearchRange: (
    paneId: TPaneId,
    range: { from: number; to: number }
  ) => void;
  saveCursorPosition: () => void;
  getOpenContext: () => OpenContext;
  getNavigationContext: () => NavigationContext;
  openChatProjection: (
    paneId: TPaneId,
    notePath: string | null,
    blockAnchor: string | null
  ) => Promise<boolean>;
  openSearchResult: (
    openContext: OpenContext,
    navigationContext: NavigationContext,
    result: SearchItem
  ) => Promise<void>;
  openRecentTask: (
    openContext: OpenContext,
    navigationContext: NavigationContext,
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

  async function handleSearchResultSelect(result: SearchItem) {
    if (
      result.documentKind &&
      result.documentKind !== 'note' &&
      (await deps.openChatProjection(
        deps.getNavigationPaneId(),
        result.notePath,
        result.blockAnchor ?? null
      ))
    ) {
      deps.clearSearch();
      return;
    }

    deps.resetPaneCommand();
    if (
      deps.getSearchMode() === 'current' &&
      result.currentMatchRange
    ) {
      deps.clearSearch();
      const paneId = deps.getNavigationPaneId();
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
      deps.getOpenContext(),
      deps.getNavigationContext(),
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
    deps.focusSearchRange(
      paneId,
      result.currentMatchRange
    );
    deps.saveCursorPosition();
  }

  async function handleRecentTaskSelect(
    task: RecentTaskItem
  ) {
    deps.resetPaneCommand();
    await deps.openRecentTask(
      deps.getOpenContext(),
      deps.getNavigationContext(),
      task
    );
    deps.saveCursorPosition();
  }

  async function handleRelatedItemSelect(
    item: RelatedNoteItem
  ) {
    if (
      item.documentKind &&
      item.documentKind !== 'note' &&
      (await deps.openChatProjection(
        deps.getNavigationPaneId(),
        item.notePath,
        item.blockAnchor ?? null
      ))
    ) {
      return;
    }

    deps.resetPaneCommand();
    await deps.openSearchResult(
      deps.getOpenContext(),
      deps.getNavigationContext(),
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
