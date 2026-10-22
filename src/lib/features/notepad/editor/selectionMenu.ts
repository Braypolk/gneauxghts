import { EditorView } from '@codemirror/view';
import { selectedImage } from '../images/imageState';
import { isDateTimePickerOpen } from '#lib/features/tasks/dateTimePicker.js';
import {
  applyBlockTypeSelection,
  blockTypeMenuGroups
} from '#lib/features/notepad/editor/blockTypes.js';
import {
  buildEditorMenuModel,
  type EditorMenuGroupWithItems
} from '#lib/features/notepad/editor/editorMenuModel.js';
import { applyInlineFormat, getActiveInlineFormats, type InlineFormatId } from '#lib/features/notepad/editor/inlineFormatting.js';
import {
  consumeMenuKeyEvent,
  stepMenuHoverGroup,
  stepMenuHoverIndex
} from '#lib/features/notepad/editor/editorMenuKeyboard.js';
import { emitSelectionMenuUpdate } from '#lib/features/notepad/editor/selectionMenuBridge.js';
import type { NativeSelectionMenuTarget } from './selectionMenuTarget';
import { keyboardShortcutMatchesEvent } from '#lib/keyboardShortcuts.svelte.js';

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
      nativeAnchor?: NativeSelectionMenuTarget['anchor'];
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
      nativeAnchor?: NativeSelectionMenuTarget['anchor'];
    };

function getSelectionRange(view: EditorView) {
  const selection = view.state.selection.main;
  if (selection.empty || selectedImage(view.state)) {
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
  #nativeTarget: NativeSelectionMenuTarget | null = null;
  #applyingNative = false;

  constructor(view: EditorView) {
    this.#view = view;
    window.addEventListener('resize', this.handleWindowResize, true);
    this.sync(this.#view);
  }

  sync(view: EditorView) {
    if (this.#applyingNative) return;
    const range = this.#readRange();
    if ((!this.#nativeTarget && !view.hasFocus) || !range || isDateTimePickerOpen()) {
      this.hide();
      return;
    }

    this.#menuState = buildEditorMenuModel(blockTypeMenuGroups);
    this.#hoverIndex = Math.min(this.#hoverIndex, Math.max(0, this.#menuState.size - 1));
    this.#emitOpen(view, range);
  }

  hide() {
    this.#nativeTarget = null;
    this.#visible = false;
    this.#blockPanelOpen = false;
    emitSelectionMenuUpdate(this.#view, { open: false });
  }

  destroy() {
    window.removeEventListener('resize', this.handleWindowResize, true);
    this.hide();
  }

  toggleBlockPanel() {
    if (!this.#visible || this.#nativeTarget) {
      return;
    }
    this.#blockPanelOpen = !this.#blockPanelOpen;
    this.#emitOpen(this.#view);
  }

  setBlockPanelOpen(open: boolean) {
    if (!this.#visible || this.#nativeTarget || this.#blockPanelOpen === open) {
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
    if (!this.#visible) return;
    const target = this.#nativeTarget;
    if (target) {
      const range = this.#readRange();
      if (!range) { this.hide(); return; }
      // Selection stays pane-local. Only the ordinary formatting transaction
      // enters the document's shared history; the native input retains focus.
      this.#applyingNative = true;
      try {
        this.#view.dispatch({ selection: { anchor: range.from, head: range.to } });
        applyInlineFormat(this.#view, id, { focus: false, scrollIntoView: false, isolateHistory: true });
        const selection = this.#view.state.selection.main;
        if (this.#nativeTarget === target) target.restoreSelection(selection);
      } finally {
        this.#applyingNative = false;
      }
    } else {
      applyInlineFormat(this.#view, id);
    }
    this.sync(this.#view);
  }

  setNativeTarget(target: NativeSelectionMenuTarget) {
    this.#nativeTarget = target;
    this.#blockPanelOpen = false;
    this.sync(this.#view);
  }

  clearNativeTarget(target: NativeSelectionMenuTarget) {
    if (this.#nativeTarget === target) this.hide();
  }

  #readRange() {
    if (!this.#nativeTarget) return getSelectionRange(this.#view);
    if (this.#view.state.readOnly || this.#view.composing) return null;
    const range = this.#nativeTarget.read();
    return range && range.from >= 0 && range.from < range.to && range.to <= this.#view.state.doc.length
      ? range : null;
  }

  runBlockAtIndex(index: number) {
    if (!this.#visible || this.#nativeTarget) return;
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

    if (this.#nativeTarget && !event.isComposing) {
      for (const [format, shortcut] of [
        ['bold', 'editorBold'], ['italic', 'editorItalic'], ['link', 'editorLink']
      ] as const) {
        if (keyboardShortcutMatchesEvent(event, shortcut)) {
          consumeMenuKeyEvent(event);
          this.applyInline(format);
          return;
        }
      }
    }

    if (event.key === 'Escape') {
      if (this.#nativeTarget) {
        // The cell's native key handler also exits editing on this Escape.
        this.hide();
        return;
      }
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
    const selection = range ?? this.#readRange();
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
      ...(this.#nativeTarget ? { nativeAnchor: this.#nativeTarget.anchor } : {}),
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
              controller.sync(view);
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

export function selectionMenuSetNativeTarget(view: EditorView, target: NativeSelectionMenuTarget) {
  selectionControllers.get(view)?.setNativeTarget(target);
}

export function selectionMenuClearNativeTarget(view: EditorView, target: NativeSelectionMenuTarget) {
  selectionControllers.get(view)?.clearNativeTarget(target);
}
