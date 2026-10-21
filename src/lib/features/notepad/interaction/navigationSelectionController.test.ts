import { describe, expect, it, vi } from 'vitest';
import type {
  NavigationContext,
  NavigationContextSource,
  OpenContext
} from '#lib/features/notepad/navigation/openFlow.js';
import type { SearchMode } from '#lib/features/notepad/search/search.js';
import type {
  RelatedNoteItem,
  SearchItem
} from '#lib/types/semantic.js';
import { createNavigationSelectionController, type NavigationSelectionControllerDeps } from './navigationSelectionController';

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
  let activePaneId = paneId;
  const clearSearch = vi.fn();
  const resetPaneCommand = vi.fn();
  const activatePane = vi.fn();
  const focusSearchRange = vi.fn();
  const saveCursorPosition = vi.fn();
  const openSearchResult = vi.fn<NavigationSelectionControllerDeps<string>['openSearchResult']>(async () => undefined);
  const openRecentTask = vi.fn<NavigationSelectionControllerDeps<string>['openRecentTask']>(async () => undefined);
  const afterRender = vi.fn(async () => undefined);
  const openContext = { clearSearch } as unknown as OpenContext;
  const navigationContext = {} as NavigationContext;
  const getOpenContext = vi.fn(() => openContext);
  const getNavigationContext = vi.fn(() => navigationContext);
  const controller = createNavigationSelectionController({
    getSearchMode: () => searchMode,
    getActivePaneId: () => activePaneId,
    resetPaneCommand,
    getNavigationPaneId: () => paneId,
    activatePane,
    focusSearchRange,
    saveCursorPosition,
    getOpenContext,
    getNavigationContext,
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
    openSearchResult,
    openRecentTask,
    afterRender,
    openContext,
    navigationContext,
    getOpenContext,
    getNavigationContext,
    setActivePane: (value: string) => { activePaneId = value; },
    setSearchMode: (value: SearchMode) => {
      searchMode = value;
    }
  };
}

describe('navigation selection controller', () => {
  it.each(['search', 'related', 'task'])('binds a %s selection to the active pane throughout navigation', async kind => {
    const harness = setup();
    harness.setActivePane('chat-pane');
    if (kind === 'related') {
      await harness.controller.handleRelatedItemSelect({ noteId: 'note-1', notePath: '/vault/Note.md', noteTitle: 'Note' } as RelatedNoteItem);
    } else if (kind === 'task') {
      await harness.controller.handleRecentTaskSelect({ noteId: 'note-1', notePath: '/vault/Note.md', text: 'task' } as Parameters<typeof harness.controller.handleRecentTaskSelect>[0]);
    } else await harness.controller.handleSearchResultSelect(searchResult());
    expect(harness.getOpenContext).toHaveBeenCalledWith('chat-pane');
    const navigation = (kind === 'task' ? harness.openRecentTask : harness.openSearchResult).mock.calls[0][1] as NavigationContextSource;
    harness.setActivePane('other-pane');
    navigation();
    expect(harness.getNavigationContext).toHaveBeenCalledWith('chat-pane');
  });
  it('opens authored Chats files as ordinary search results', async () => {
    const harness = setup();
    const result = searchResult({ documentKind: 'note', notePath: 'Chats/Ideas/Part 001.md', blockAnchor: 'reply' });
    await harness.controller.handleSearchResultSelect(result);
    expect(harness.openSearchResult).toHaveBeenCalledWith(expect.anything(), expect.any(Function), result);
    expect(harness.clearSearch).not.toHaveBeenCalled();
  });

  it('focuses an in-document search range after render', async () => {
    const harness = setup();
    harness.setSearchMode('current');
    const result = searchResult({
      currentMatchRange: { from: 4, to: 9 }
    });

    await harness.controller.handleSearchResultSelect(result);

    expect(harness.resetPaneCommand).toHaveBeenCalledOnce();
    expect(harness.clearSearch).not.toHaveBeenCalled();
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
      { from: 4, to: 9 },
      { focus: false }
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
      expect.any(Function),
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
