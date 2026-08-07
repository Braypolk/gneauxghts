import { describe, expect, it, vi } from 'vitest';
import type {
  NavigationContext,
  OpenContext
} from '$lib/features/notepad/navigation/openFlow';
import type { SearchMode } from '$lib/features/notepad/search/search';
import type {
  RelatedNoteItem,
  SearchItem
} from '$lib/types/semantic';
import { createNavigationSelectionController } from './navigationSelectionController';

const paneId = 'pane-1';

function searchResult(
  overrides: Partial<SearchItem> = {}
): SearchItem {
  return {
    noteId: 'note-1',
    notePath: '/vault/Note.md',
    fileName: 'Note.md',
    sectionLabel: 'Body',
    excerpt: 'match',
    highlightRanges: [],
    matchText: 'match',
    reasonLabels: [],
    lexicalScore: 1,
    semanticScore: null,
    startLine: 1,
    endLine: 1,
    blockAnchor: null,
    ...overrides
  };
}

function setup() {
  let searchMode: SearchMode = 'all';
  const clearSearch = vi.fn();
  const resetPaneCommand = vi.fn();
  const activatePane = vi.fn();
  const focusSearchRange = vi.fn();
  const saveCursorPosition = vi.fn();
  const openChatProjection = vi.fn(async () => false);
  const openSearchResult = vi.fn(async () => undefined);
  const openRecentTask = vi.fn(async () => undefined);
  const afterRender = vi.fn(async () => undefined);
  const openContext = {} as OpenContext;
  const navigationContext = {} as NavigationContext;
  const controller = createNavigationSelectionController({
    getSearchMode: () => searchMode,
    clearSearch,
    resetPaneCommand,
    getNavigationPaneId: () => paneId,
    activatePane,
    focusSearchRange,
    saveCursorPosition,
    getOpenContext: () => openContext,
    getNavigationContext: () => navigationContext,
    openChatProjection,
    openSearchResult,
    openRecentTask,
    afterRender
  });
  return {
    controller,
    clearSearch,
    resetPaneCommand,
    activatePane,
    focusSearchRange,
    saveCursorPosition,
    openChatProjection,
    openSearchResult,
    openRecentTask,
    afterRender,
    openContext,
    navigationContext,
    setSearchMode: (value: SearchMode) => {
      searchMode = value;
    }
  };
}

describe('navigation selection controller', () => {
  it('routes non-note search results to chat and clears search', async () => {
    const harness = setup();
    harness.openChatProjection.mockResolvedValue(true);
    const result = searchResult({
      documentKind: 'chatTranscript',
      notePath: 'Chats/Ideas/Part 001.md',
      blockAnchor: 'message-1'
    });

    await harness.controller.handleSearchResultSelect(result);

    expect(
      harness.openChatProjection
    ).toHaveBeenCalledWith(
      paneId,
      'Chats/Ideas/Part 001.md',
      'message-1'
    );
    expect(harness.clearSearch).toHaveBeenCalledOnce();
    expect(
      harness.openSearchResult
    ).not.toHaveBeenCalled();
  });

  it('focuses an in-document search range after render', async () => {
    const harness = setup();
    harness.setSearchMode('current');
    const result = searchResult({
      currentMatchRange: { from: 4, to: 9 }
    });

    await harness.controller.handleSearchResultSelect(result);

    expect(harness.resetPaneCommand).toHaveBeenCalledOnce();
    expect(harness.clearSearch).toHaveBeenCalledOnce();
    expect(harness.activatePane).toHaveBeenCalledWith(paneId);
    expect(harness.afterRender).toHaveBeenCalledOnce();
    expect(harness.focusSearchRange).toHaveBeenCalledWith(
      paneId,
      { from: 4, to: 9 }
    );
    expect(
      harness.saveCursorPosition
    ).toHaveBeenCalledOnce();
  });

  it('previews a match without persisting the cursor the user came from', async () => {
    const harness = setup();
    harness.setSearchMode('current');

    await harness.controller.handleSearchResultNavigate(
      searchResult({ currentMatchRange: { from: 4, to: 9 } })
    );

    expect(harness.focusSearchRange).toHaveBeenCalledWith(
      paneId,
      { from: 4, to: 9 }
    );
    expect(harness.saveCursorPosition).not.toHaveBeenCalled();
  });

  it('maps a related note into the shared search-result navigation shape', async () => {
    const harness = setup();
    const item = {
      noteId: 'note-2',
      notePath: '/vault/Related.md',
      noteTitle: 'Related',
      sectionLabel: 'Ideas',
      excerpt: 'related excerpt',
      matchText: 'related',
      score: 0.8,
      startLine: 2,
      endLine: 3,
      blockAnchor: null,
      documentKind: 'note'
    } as RelatedNoteItem;

    await harness.controller.handleRelatedItemSelect(item);

    expect(harness.openSearchResult).toHaveBeenCalledWith(
      harness.openContext,
      harness.navigationContext,
      expect.objectContaining({
        noteId: 'note-2',
        notePath: '/vault/Related.md',
        reasonLabels: ['related'],
        semanticScore: 0.8
      })
    );
    expect(
      harness.saveCursorPosition
    ).toHaveBeenCalledOnce();
  });
});
