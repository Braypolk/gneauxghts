import { describe, expect, it, vi } from 'vitest';
import { createWikilinkInteractionController } from './wikilinkInteractionController';

const paneId = 'pane-1';

function setup() {
  const transientUi = {
    updateWikilinkState: vi.fn(),
    closeSelectionMenu: vi.fn(),
    closeSlashMenu: vi.fn(),
    closeExcept: vi.fn(),
    closeWikilinkAutocomplete: vi.fn(),
    handleActiveWikilinkChange: vi.fn()
  };
  const wikilinkController = {
    handleAutocompleteKeydown: vi.fn(() => true),
    openWikilink: vi.fn(async () => undefined),
    selectWikilinkSuggestion: vi.fn()
  };
  const setActivePane = vi.fn();
  const openChatProjection = vi.fn(async () => true);
  let paneCommandPaneId: string | null = null;
  const state = {
    active: true,
    activeWikilink: null,
    suggestions: [
      {
        kind: 'note' as const,
        value: 'One',
        label: 'One',
        detail: ''
      },
      {
        kind: 'note' as const,
        value: 'Two',
        label: 'Two',
        detail: ''
      }
    ],
    selectedIndex: 0,
    activeRequest: 1
  };
  const controller = createWikilinkInteractionController({
    transientUi,
    getPaneCommandPaneId: () => paneCommandPaneId,
    getNavigationPaneId: () => paneId,
    getWikilinkController: () => wikilinkController,
    setActivePane,
    openChatProjection,
    getWikilinkState: () => state
  });
  return {
    controller,
    transientUi,
    wikilinkController,
    setActivePane,
    openChatProjection,
    setPaneCommandPaneId: (value: string | null) => {
      paneCommandPaneId = value;
    }
  };
}

describe('wikilink interaction controller', () => {
  it('lets pane commands take keyboard precedence', () => {
    const harness = setup();
    const event = {} as KeyboardEvent;

    harness.setPaneCommandPaneId(paneId);
    expect(
      harness.controller.handleWikilinkKeydown(event)
    ).toBe(false);
    expect(
      harness.wikilinkController.handleAutocompleteKeydown
    ).not.toHaveBeenCalled();

    harness.setPaneCommandPaneId(null);
    expect(
      harness.controller.handleWikilinkKeydown(event)
    ).toBe(true);
  });

  it('opens chat projection wikilinks before ordinary note links', async () => {
    const harness = setup();

    await harness.controller.openWikilink(
      paneId,
      'Chats/Ideas#reply'
    );

    expect(harness.setActivePane).toHaveBeenCalledWith(paneId);
    expect(
      harness.openChatProjection
    ).toHaveBeenCalledWith(paneId, 'Chats/Ideas.md');
    expect(
      harness.wikilinkController.openWikilink
    ).not.toHaveBeenCalled();
  });

  it('falls through when a chat projection is unavailable', async () => {
    const harness = setup();
    harness.openChatProjection.mockResolvedValue(false);

    await harness.controller.openWikilink(
      paneId,
      'Chats/Missing'
    );

    expect(
      harness.wikilinkController.openWikilink
    ).toHaveBeenCalledWith('Chats/Missing');
  });

  it('updates selection state before accepting a suggestion', () => {
    const harness = setup();

    harness.controller.handleWikilinkSuggestionSelect(
      paneId,
      'Two'
    );

    expect(
      harness.transientUi.updateWikilinkState
    ).toHaveBeenCalledWith(
      paneId,
      expect.objectContaining({ selectedIndex: 1 })
    );
    expect(
      harness.wikilinkController.selectWikilinkSuggestion
    ).toHaveBeenCalledWith('Two');
  });
});
