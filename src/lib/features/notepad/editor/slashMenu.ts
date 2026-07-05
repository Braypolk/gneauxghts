import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  applyBlockTypeSelection,
  slashMenuGroups,
  slashMenuOptionIds
} from '$lib/features/notepad/editor/blockTypes';
import {
  buildEditorMenuModel,
  type EditorMenuGroupWithItems,
  type EditorMenuItemWithIndex
} from '$lib/features/notepad/editor/editorMenuModel';
import {
  consumeMenuKeyEvent,
  stepMenuHoverGroup,
  stepMenuHoverIndex
} from '$lib/features/notepad/editor/editorMenuKeyboard';
import { emitSlashMenuUpdate } from '$lib/features/notepad/editor/slashMenuBridge';

const slashMenuFloatingReferenceByView = new WeakMap<EditorView, HTMLElement>();

export function setSlashMenuFloatingReference(view: EditorView, element: HTMLElement | null): void {
  if (element === null) {
    slashMenuFloatingReferenceByView.delete(view);
  } else {
    slashMenuFloatingReferenceByView.set(view, element);
  }
}

export function getSlashMenuFloatingReference(view: EditorView): HTMLElement | null {
  const element = slashMenuFloatingReferenceByView.get(view);
  if (!element?.isConnected) {
    if (element) {
      slashMenuFloatingReferenceByView.delete(view);
    }
    return null;
  }
  return element;
}

export type SlashMenuItemWithIndex = EditorMenuItemWithIndex;
export type SlashMenuGroupWithItems = EditorMenuGroupWithItems;

interface SlashMenuModel {
  groups: EditorMenuGroupWithItems[];
  size: number;
}

export type SlashMenuSnapshot =
  | { open: false }
  | {
      open: true;
      anchorPos: number;
      groups: SlashMenuGroupWithItems[];
      hoverIndex: number;
    };

/** Pane-local slash menu state, including the bound editor view for positioning. */
export type PaneSlashMenuModel =
  | { open: false }
  | {
      open: true;
      view: EditorView;
      anchorPos: number;
      groups: SlashMenuGroupWithItems[];
      hoverIndex: number;
    };

export interface SlashMenuAPI {
  show: (pos: number) => void;
  hide: () => void;
}

export function getSlashMenuState(filter = ''): SlashMenuModel {
  return buildEditorMenuModel(slashMenuGroups, filter);
}

function getSelectionLine(view: EditorView) {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return null;
  }
  return view.state.doc.lineAt(selection.head);
}

function isSelectionAtEndOfLine(view: EditorView) {
  const line = getSelectionLine(view);
  if (!line) {
    return false;
  }
  return view.state.selection.main.head === line.to;
}

function isSlashTriggerLine(view: EditorView): boolean {
  const line = getSelectionLine(view);
  if (!line) {
    return false;
  }
  return line.text.startsWith('/');
}

function deleteSlashTriggerText(view: EditorView): void {
  const line = getSelectionLine(view);
  if (!line || !isSelectionAtEndOfLine(view)) {
    return;
  }

  view.dispatch(
    view.state.update({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from }
    })
  );
}

function runSlashMenuSelection(view: EditorView, optionId: string) {
  if (!slashMenuOptionIds.has(optionId)) {
    return;
  }

  if (isSlashTriggerLine(view)) {
    deleteSlashTriggerText(view);
  }

  applyBlockTypeSelection(view, optionId);
}

function getCurrentText(view: EditorView) {
  return getSelectionLine(view)?.text ?? null;
}

const slashControllers = new WeakMap<EditorView, SlashMenuController>();

class SlashMenuController {
  readonly #view: EditorView;
  #filter = '';
  #hoverIndex = 0;
  #programmaticPos: number | null = null;
  #menuState: SlashMenuModel = getSlashMenuState();
  #visible = false;

  constructor(view: EditorView) {
    this.#view = view;
    window.addEventListener('resize', this.handleWindowResize, true);
    this.sync(this.#view);
  }

  sync(view: EditorView) {
    const shouldShow = this.#shouldShow(view);
    if (!shouldShow || this.#menuState.size === 0) {
      this.hide();
      return;
    }

    this.#emitOpen(view);
  }

  show(pos: number) {
    this.#programmaticPos = pos;
    this.#filter = '';
    this.#menuState = getSlashMenuState('');
    this.#hoverIndex = 0;
    this.sync(this.#view);
  }

  hide() {
    this.#programmaticPos = null;
    this.#visible = false;
    slashMenuFloatingReferenceByView.delete(this.#view);
    emitSlashMenuUpdate(this.#view, { open: false });
  }

  destroy() {
    window.removeEventListener('resize', this.handleWindowResize, true);
    this.hide();
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

  runAtIndex(index: number, { hideMenu = true }: { hideMenu?: boolean } = {}) {
    const item = this.#menuState.groups
      .flatMap((group) => group.items)
      .find((candidate) => candidate.index === index);
    if (!item) {
      return;
    }

    runSlashMenuSelection(this.#view, item.id);
    if (hideMenu) {
      this.hide();
    }
  }

  handleKeydown(event: KeyboardEvent) {
    if (!this.#visible) {
      return;
    }

    if (event.key === 'Escape') {
      consumeMenuKeyEvent(event);
      this.hide();
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
      this.hide();
      queueMicrotask(() => {
        this.runAtIndex(index, { hideMenu: false });
      });
    }
  }

  #buildOpenSnapshot(view: EditorView): SlashMenuSnapshot {
    const anchorPos = this.#programmaticPos ?? view.state.selection.main.head;
    return {
      open: true,
      anchorPos,
      groups: this.#menuState.groups,
      hoverIndex: this.#hoverIndex
    };
  }

  #emitOpen(view: EditorView) {
    this.#visible = true;
    emitSlashMenuUpdate(view, this.#buildOpenSnapshot(view));
  }

  #shouldShow(view: EditorView) {
    if (!view.hasFocus) {
      return false;
    }

    if (typeof this.#programmaticPos === 'number') {
      const maxPos = view.state.doc.length;
      this.#programmaticPos = Math.max(0, Math.min(this.#programmaticPos, maxPos));
      this.#filter = '';
      this.#menuState = getSlashMenuState('');
      this.#hoverIndex = Math.min(this.#hoverIndex, Math.max(0, this.#menuState.size - 1));
      return true;
    }

    if (!isSelectionAtEndOfLine(view)) {
      return false;
    }

    const currentText = getCurrentText(view);
    if (currentText == null || !currentText.startsWith('/')) {
      return false;
    }

    this.#filter = currentText.slice(1);
    this.#menuState = getSlashMenuState(this.#filter);
    this.#hoverIndex = Math.min(this.#hoverIndex, Math.max(0, this.#menuState.size - 1));
    return true;
  }

  private handleWindowResize = () => {
    if (this.#visible) {
      this.#emitOpen(this.#view);
    }
  };
}

export function slashMenuHandleKeydownFromUi(view: EditorView, event: KeyboardEvent) {
  slashControllers.get(view)?.handleKeydown(event);
}

export function slashMenuSetHoverFromUi(view: EditorView, index: number) {
  slashControllers.get(view)?.setHoverIndex(index);
}

export function slashMenuActivateGroupFromUi(view: EditorView, groupKey: string) {
  slashControllers.get(view)?.activateGroupTab(groupKey);
}

export function slashMenuPickFromUi(view: EditorView, index: number) {
  slashControllers.get(view)?.runAtIndex(index);
}

export function slashMenuHideFromUi(view: EditorView) {
  slashControllers.get(view)?.hide();
}

export function createSlashMenuPlugin() {
  const apiByView = new WeakMap<EditorView, SlashMenuAPI>();
  const extension = EditorView.updateListener.of((update) => {
    slashControllers.get(update.view)?.sync(update.view);
  });

  return {
    extension: [
      extension,
      EditorView.domEventHandlers({
        blur: (_event, view) => {
          const controller = slashControllers.get(view);
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
    show(view: EditorView, pos: number) {
      let controller = slashControllers.get(view);
      if (!controller) {
        controller = new SlashMenuController(view);
        slashControllers.set(view, controller);
      }
      if (!apiByView.has(view)) {
        apiByView.set(view, {
          show: (nextPos) => controller?.show(nextPos),
          hide: () => controller?.hide()
        });
      }
      controller.show(pos);
    },
    hide(view: EditorView) {
      slashControllers.get(view)?.hide();
    },
    register(view: EditorView) {
      if (!slashControllers.has(view)) {
        slashControllers.set(view, new SlashMenuController(view));
      }
    },
    unregister(view: EditorView) {
      const controller = slashControllers.get(view);
      controller?.destroy();
      slashControllers.delete(view);
      apiByView.delete(view);
    }
  };
}
