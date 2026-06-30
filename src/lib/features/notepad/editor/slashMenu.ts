import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  applyBlockTypeSelection,
  slashMenuGroups,
  slashMenuOptionIds,
  type EditorMenuOption
} from '$lib/features/notepad/editor/blockTypes';
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

export interface SlashMenuItemWithIndex extends EditorMenuOption {
  index: number;
}

export interface SlashMenuGroupWithItems {
  key: string;
  label: string;
  range: readonly [number, number];
  items: SlashMenuItemWithIndex[];
}

interface SlashMenuModel {
  groups: SlashMenuGroupWithItems[];
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
  const normalizedFilter = filter.trim().toLowerCase();
  const groups: SlashMenuGroupWithItems[] = [];
  let index = 0;

  for (const group of slashMenuGroups) {
    const items = group.items
      .filter((item) => {
        if (normalizedFilter === '') {
          return true;
        }
        return item.label.toLowerCase().includes(normalizedFilter);
      })
      .map((item) => ({
        ...item,
        index: index++
      }));

    if (items.length === 0) {
      continue;
    }

    groups.push({
      key: group.key,
      label: group.label,
      range: [items[0].index, items[items.length - 1].index + 1],
      items
    });
  }

  return {
    groups,
    size: index
  };
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

function consumeKeyEvent(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
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
      consumeKeyEvent(event);
      this.hide();
      return;
    }

    if (event.key === 'ArrowDown') {
      consumeKeyEvent(event);
      this.setHoverIndex(this.#hoverIndex + 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      consumeKeyEvent(event);
      this.setHoverIndex(this.#hoverIndex - 1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      consumeKeyEvent(event);
      const group = this.#menuState.groups.find(
        (candidate) =>
          this.#hoverIndex >= candidate.range[0] && this.#hoverIndex < candidate.range[1]
      );
      if (!group) {
        return;
      }

      const previousGroup = this.#menuState.groups[this.#menuState.groups.indexOf(group) - 1];
      if (previousGroup) {
        this.setHoverIndex(previousGroup.range[1] - 1);
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      consumeKeyEvent(event);
      const group = this.#menuState.groups.find(
        (candidate) =>
          this.#hoverIndex >= candidate.range[0] && this.#hoverIndex < candidate.range[1]
      );
      if (!group) {
        return;
      }

      const nextGroup = this.#menuState.groups[this.#menuState.groups.indexOf(group) + 1];
      if (nextGroup) {
        this.setHoverIndex(nextGroup.range[0]);
      }
      return;
    }

    if (event.key === 'Enter') {
      consumeKeyEvent(event);
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

export function refreshSlashMenuLayout(view: EditorView) {
  slashControllers.get(view)?.sync(view);
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
