import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { PaneRuntime } from './paneRuntime.svelte';
import { PaneTransientUiController } from './paneTransientUiController.svelte';

type PaneId = 'left' | 'right';

function createHarness() {
  const runtimes = {
    left: {
      setSlashMenu: vi.fn(),
      setSelectionMenu: vi.fn(),
      setWikilinkAutocomplete: vi.fn()
    },
    right: {
      setSlashMenu: vi.fn(),
      setSelectionMenu: vi.fn(),
      setWikilinkAutocomplete: vi.fn()
    }
  };
  const editors = {
    left: {
      closeSlashMenu: vi.fn(),
      closeSelectionMenu: vi.fn()
    },
    right: {
      closeSlashMenu: vi.fn(),
      closeSelectionMenu: vi.fn()
    }
  };
  const wikilinks = {
    left: {
      closeWikilinkAutocomplete: vi.fn(),
      handleActiveWikilinkChange: vi.fn()
    },
    right: {
      closeWikilinkAutocomplete: vi.fn(),
      handleActiveWikilinkChange: vi.fn()
    }
  };
  const controller = new PaneTransientUiController<PaneId>({
    getActivePaneId: () => 'left',
    getVisiblePaneIds: () => ['left', 'right'],
    getPaneRuntime: (paneId) =>
      runtimes[paneId] as unknown as PaneRuntime,
    getEditorCapabilities: (paneId) =>
      editors[
        paneId
      ] as unknown as EditorCapabilityAdapter,
    getWikilinkController: (paneId) => wikilinks[paneId]
  });

  return { controller, runtimes };
}

describe('PaneTransientUiController', () => {
  it('publishes only the owner selected by the discriminated state', () => {
    const { controller } = createHarness();
    const view = {} as EditorView;

    controller.applySlashMenuSnapshot(
      'left',
      {
        open: true,
        anchorPos: 0,
        groups: [],
        hoverIndex: 0
      },
      view
    );
    expect(controller.active).toEqual({
      kind: 'slash-menu',
      paneId: 'left'
    });
    expect(controller.active).toEqual({
      kind: 'slash-menu',
      paneId: 'left'
    });

    controller.applySelectionMenuSnapshot(
      'left',
      {
        open: true,
        selectionFrom: 0,
        selectionTo: 1,
        groups: [],
        hoverIndex: 0,
        blockPanelOpen: false,
        activeInlineFormats: []
      },
      view
    );
    expect(controller.active).toEqual({
      kind: 'selection-menu',
      paneId: 'left'
    });
    expect(controller.active).toEqual({
      kind: 'selection-menu',
      paneId: 'left'
    });

    controller.updateWikilinkState('right', {
      active: true,
      activeWikilink: null,
      suggestions: [],
      selectedIndex: 0,
      activeRequest: 1
    });
    expect(controller.active).toEqual({
      kind: 'wikilink-autocomplete',
      paneId: 'right'
    });
    expect(controller.active).toEqual({
      kind: 'wikilink-autocomplete',
      paneId: 'right'
    });
  });

  it('does not close an active surface when a different owner closes', () => {
    const { controller, runtimes } = createHarness();
    const view = {} as EditorView;

    controller.applySlashMenuSnapshot(
      'left',
      {
        open: true,
        anchorPos: 0,
        groups: [],
        hoverIndex: 0
      },
      view
    );
    controller.closeSlashMenu('right');

    expect(controller.active).toEqual({
      kind: 'slash-menu',
      paneId: 'left'
    });
    expect(runtimes.right.setSlashMenu).toHaveBeenCalledWith({
      open: false
    });
  });
});
