import { EditorView } from '@codemirror/view';
import {
  applyBlockTypeSelection,
  blockTypeMenuGroups
} from '$lib/features/notepad/editor/blockTypes';
import {
  buildEditorMenuModel,
  type EditorMenuGroupWithItems
} from '$lib/features/notepad/editor/editorMenuModel';
import { applyInlineFormat, getActiveInlineFormats, type InlineFormatId } from '$lib/features/notepad/editor/inlineFormatting';
import {
  consumeMenuKeyEvent,
  stepMenuHoverGroup,
  stepMenuHoverIndex
} from '$lib/features/notepad/editor/editorMenuKeyboard';
import { emitSelectionMenuUpdate } from '$lib/features/notepad/editor/selectionMenuBridge';

export type { EditorMenuGroupWithItems as SelectionMenuGroupWithItems };

export type SelectionMenuSnapshot =
  | { open: false }
  | {
      open: true;
      selectionFrom: number;
      selectionTo: number;
      groups: EditorMenuGroupWithItems[];
      hoverIndex: number;
      blockPanelOpen: boolean;
      activeInlineFormats: readonly InlineFormatId[];
    };

export type PaneSelectionMenuModel =
  | { open: false }
  | {
      open: true;
      view: EditorView;
      selectionFrom: number;
      selectionTo: number;
      groups: EditorMenuGroupWithItems[];
      hoverIndex: number;
      blockPanelOpen: boolean;
      activeInlineFormats: readonly InlineFormatId[];
    };

function getSelectionRange(view: EditorView) {
  const selection = view.state.selection.main;
  if (selection.empty) {
    return null;
  }
  return {
    from: selection.from,
    to: selection.to
  };
}

const selectionControllers = new WeakMap<EditorView, SelectionMenuController>();

class SelectionMenuController {
  readonly #view: EditorView;
  #menuState = buildEditorMenuModel(blockTypeMenuGroups);
  #hoverIndex = 0;
  #blockPanelOpen = false;
  #visible = false;

  constructor(view: EditorView) {
    this.#view = view;
    window.addEventListener('resize', this.handleWindowResize, true);
    this.sync(this.#view);
  }

  sync(view: EditorView) {
    const range = getSelectionRange(view);
    if (!view.hasFocus || !range) {
      this.hide();
      return;
    }

    this.#menuState = buildEditorMenuModel(blockTypeMenuGroups);
    this.#hoverIndex = Math.min(this.#hoverIndex, Math.max(0, this.#menuState.size - 1));
    this.#emitOpen(view, range);
  }

  hide() {
    this.#visible = false;
    this.#blockPanelOpen = false;
    emitSelectionMenuUpdate(this.#view, { open: false });
  }

  destroy() {
    window.removeEventListener('resize', this.handleWindowResize, true);
    this.hide();
  }

  toggleBlockPanel() {
    if (!this.#visible) {
      return;
    }
    this.#blockPanelOpen = !this.#blockPanelOpen;
    this.#emitOpen(this.#view);
  }

  setBlockPanelOpen(open: boolean) {
    if (!this.#visible || this.#blockPanelOpen === open) {
      return;
    }
    this.#blockPanelOpen = open;
    this.#emitOpen(this.#view);
  }

  setHoverIndex(index: number) {
    if (this.#menuState.size === 0) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(index, this.#menuState.size - 1));
    if (nextIndex === this.#hoverIndex) {
      return;
    }

    this.#hoverIndex = nextIndex;
    this.#emitOpen(this.#view);
  }

  activateGroupTab(groupKey: string) {
    const group = this.#menuState.groups.find((candidate) => candidate.key === groupKey);
    if (!group) {
      return;
    }

    this.setHoverIndex(group.range[0]);
  }

  applyInline(id: InlineFormatId) {
    applyInlineFormat(this.#view, id);
    this.sync(this.#view);
  }

  runBlockAtIndex(index: number) {
    const item = this.#menuState.groups
      .flatMap((group) => group.items)
      .find((candidate) => candidate.index === index);
    if (!item) {
      return;
    }

    applyBlockTypeSelection(this.#view, item.id);
    this.#blockPanelOpen = false;
    this.sync(this.#view);
  }

  handleKeydown(event: KeyboardEvent) {
    if (!this.#visible) {
      return;
    }

    if (event.key === 'Escape') {
      consumeMenuKeyEvent(event);
      if (this.#blockPanelOpen) {
        this.#blockPanelOpen = false;
        this.#emitOpen(this.#view);
        return;
      }
      this.hide();
      return;
    }

    if (!this.#blockPanelOpen) {
      return;
    }

    if (event.key === 'ArrowDown') {
      consumeMenuKeyEvent(event);
      this.setHoverIndex(stepMenuHoverIndex(this.#hoverIndex, 'down', this.#menuState.size));
      return;
    }

    if (event.key === 'ArrowUp') {
      consumeMenuKeyEvent(event);
      this.setHoverIndex(stepMenuHoverIndex(this.#hoverIndex, 'up', this.#menuState.size));
      return;
    }

    if (event.key === 'ArrowLeft') {
      consumeMenuKeyEvent(event);
      const nextIndex = stepMenuHoverGroup(this.#hoverIndex, 'left', this.#menuState.groups);
      if (nextIndex !== null) {
        this.setHoverIndex(nextIndex);
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      consumeMenuKeyEvent(event);
      const nextIndex = stepMenuHoverGroup(this.#hoverIndex, 'right', this.#menuState.groups);
      if (nextIndex !== null) {
        this.setHoverIndex(nextIndex);
      }
      return;
    }

    if (event.key === 'Enter') {
      consumeMenuKeyEvent(event);
      const index = this.#hoverIndex;
      queueMicrotask(() => {
        this.runBlockAtIndex(index);
      });
    }
  }

  #buildOpenSnapshot(view: EditorView, range?: { from: number; to: number }): SelectionMenuSnapshot {
    const selection = range ?? getSelectionRange(view);
    if (!selection) {
      return { open: false };
    }

    return {
      open: true,
      selectionFrom: selection.from,
      selectionTo: selection.to,
      groups: this.#menuState.groups,
      hoverIndex: this.#hoverIndex,
      blockPanelOpen: this.#blockPanelOpen,
      activeInlineFormats: getActiveInlineFormats(
        view.state,
        selection.from,
        selection.to
      )
    };
  }

  #emitOpen(view: EditorView, range?: { from: number; to: number }) {
    const snapshot = this.#buildOpenSnapshot(view, range);
    if (!snapshot.open) {
      this.hide();
      return;
    }

    this.#visible = true;
    emitSelectionMenuUpdate(view, snapshot);
  }

  private handleWindowResize = () => {
    if (this.#visible) {
      this.#emitOpen(this.#view);
    }
  };
}

export function selectionMenuHandleKeydownFromUi(view: EditorView, event: KeyboardEvent) {
  selectionControllers.get(view)?.handleKeydown(event);
}

export function selectionMenuSetHoverFromUi(view: EditorView, index: number) {
  selectionControllers.get(view)?.setHoverIndex(index);
}

export function selectionMenuActivateGroupFromUi(view: EditorView, groupKey: string) {
  selectionControllers.get(view)?.activateGroupTab(groupKey);
}

export function selectionMenuPickBlockFromUi(view: EditorView, index: number) {
  selectionControllers.get(view)?.runBlockAtIndex(index);
}

export function selectionMenuApplyInlineFromUi(view: EditorView, id: InlineFormatId) {
  selectionControllers.get(view)?.applyInline(id);
}

export function selectionMenuToggleBlockPanelFromUi(view: EditorView) {
  selectionControllers.get(view)?.toggleBlockPanel();
}

export function selectionMenuHideFromUi(view: EditorView) {
  selectionControllers.get(view)?.hide();
}

export function createSelectionMenuPlugin() {
  const extension = EditorView.updateListener.of((update) => {
    selectionControllers.get(update.view)?.sync(update.view);
  });

  return {
    extension: [
      extension,
      EditorView.domEventHandlers({
        blur: (_event, view) => {
          const controller = selectionControllers.get(view);
          if (!controller) {
            return false;
          }
          queueMicrotask(() => {
            if (!view.hasFocus) {
              controller.hide();
            }
          });
          return false;
        }
      })
    ],
    hide(view: EditorView) {
      selectionControllers.get(view)?.hide();
    },
    register(view: EditorView) {
      if (!selectionControllers.has(view)) {
        selectionControllers.set(view, new SelectionMenuController(view));
      }
    },
    unregister(view: EditorView) {
      const controller = selectionControllers.get(view);
      controller?.destroy();
      selectionControllers.delete(view);
    }
  };
}
