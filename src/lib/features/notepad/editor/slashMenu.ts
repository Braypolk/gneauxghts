import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  applyBlockTypeSelection,
  createTaskListTransaction,
  slashMenuGroups,
  slashMenuOptionIds,
  type EditorMenuOption
} from '$lib/features/notepad/editor/blockTypes';
import { emitSlashMenuUpdate } from '$lib/features/notepad/editor/slashMenuBridge';

/** When set, Floating UI anchors the slash menu to this element (e.g. block handle) instead of the caret. */
const slashMenuFloatingReferenceByView = new WeakMap<EditorView, HTMLElement>();

export function setSlashMenuFloatingReference(view: EditorView, element: HTMLElement | null): void {
  if (element === null) {
    slashMenuFloatingReferenceByView.delete(view);
  } else {
    slashMenuFloatingReferenceByView.set(view, element);
  }
}

export function getSlashMenuFloatingReference(view: EditorView): HTMLElement | null {
  const el = slashMenuFloatingReferenceByView.get(view);
  if (!el?.isConnected) {
    if (el) {
      slashMenuFloatingReferenceByView.delete(view);
    }
    return null;
  }
  return el;
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
      /** Document position used with `view.coordsAtPos` for Floating UI reference. */
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

/** True when this block is a typed-slash line (`/…`), not a programmatic open from the handle / + button. */
function isSlashTriggerLine(view: EditorView): boolean {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) {
    return false;
  }
  const { $from } = selection;
  const parent = $from.parent;
  if (!parent.isTextblock) {
    return false;
  }
  const text = parent.textBetween(0, parent.content.size, '\n', '\0');
  return text.startsWith('/');
}

/** Removes `/…` on the current line before applying the chosen block type (typed-slash flow only). */
function deleteSlashTriggerText(view: EditorView): void {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection)) {
    return;
  }
  const { $from } = selection;
  const parent = $from.parent;
  if (!isSelectionAtEndOfNode(view) || !parent.isTextblock) {
    return;
  }
  const from = $from.start();
  const to = $from.end();
  const transaction = view.state.tr.deleteRange(from, to);
  transaction.setSelection(TextSelection.create(transaction.doc, from));
  view.dispatch(transaction);
}

function runSlashMenuSelection(view: EditorView, optionId: string) {
  if (!slashMenuOptionIds.has(optionId)) {
    return;
  }

  const slashLine = isSlashTriggerLine(view);

  if (optionId === 'taskList') {
    if (slashLine) {
      const transaction = createTaskListTransaction(view.state, {
        requireSelectionAtEnd: true,
        scrollIntoView: true
      });
      if (transaction) {
        view.dispatch(transaction);
        return;
      }
    }
    applyBlockTypeSelection(view, optionId);
    return;
  }

  if (slashLine) {
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
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) {
    return null;
  }

  const parent = selection.$from.parent;
  if (!parent.isTextblock) {
    return null;
  }

  return parent.textBetween(0, parent.content.size, '\n', '\0');
}

function isSelectionAtEndOfNode(view: EditorView) {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) {
    return false;
  }

  const { $head } = selection;
  return $head.parentOffset === $head.parent.content.size;
}

const slashControllers = new WeakMap<EditorView, SlashMenuPluginController>();

class SlashMenuPluginController {
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
    if (!shouldShow) {
      this.hide();
      return;
    }

    if (this.#menuState.size === 0) {
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
    this.#visible = false;
    slashMenuFloatingReferenceByView.delete(this.#view);
    emitSlashMenuUpdate(this.#view, { open: false });
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
    const anchorPos = this.#programmaticPos ?? view.state.selection.from;
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
      const maxSize = view.state.doc.nodeSize - 2;
      const validPos = Math.min(this.#programmaticPos, maxSize);
      const targetParent = view.state.doc.resolve(validPos).parent;
      const activeParent = view.state.selection.$from.parent;
      if (targetParent !== activeParent) {
        this.#programmaticPos = null;
        return false;
      }

      this.#filter = '';
      this.#menuState = getSlashMenuState('');
      this.#hoverIndex = Math.min(this.#hoverIndex, Math.max(0, this.#menuState.size - 1));
      return true;
    }

    if (!isSelectionAtEndOfNode(view)) {
      return false;
    }

    const currentText = getCurrentText(view);
    if (currentText == null) {
      return false;
    }

    if (!currentText.startsWith('/')) {
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

/** Recompute anchor position after layout/viewport changes (handled by plugin resize; optional for Svelte). */
export function refreshSlashMenuLayout(view: EditorView) {
  const ctrl = slashControllers.get(view);
  if (!ctrl) {
    return;
  }
  ctrl.sync(view);
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

  const plugin = new Plugin({
    key: new PluginKey('NOTEPAD_SLASH_MENU'),
    view: (view) => {
      const api: SlashMenuAPI = {
        show: () => {},
        hide: () => {}
      };
      const controller = new SlashMenuPluginController(view);
      slashControllers.set(view, controller);
      api.show = (pos) => controller.show(pos);
      api.hide = () => controller.hide();
      apiByView.set(view, api);
      return {
        update(updatedView) {
          controller.sync(updatedView);
        },
        destroy() {
          apiByView.delete(view);
          slashControllers.delete(view);
          controller.destroy();
        }
      };
    }
  });

  return {
    plugin,
    show(view: EditorView, pos: number) {
      apiByView.get(view)?.show(pos);
    },
    hide(view: EditorView) {
      apiByView.get(view)?.hide();
    }
  };
}
