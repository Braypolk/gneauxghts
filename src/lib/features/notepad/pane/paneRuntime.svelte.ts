import type { EditorController } from '$lib/features/notepad/editor/editor';
import type { PaneSlashMenuModel } from '$lib/features/notepad/editor/slashMenu';
import type { PaneSelectionMenuModel } from '$lib/features/notepad/editor/selectionMenu';
import {
  createWikilinkAutocompleteState,
  type WikilinkAutocompleteState
} from '$lib/features/notepad/wikilinks/state';
import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';

/**
 * Pane-local UI state (not shared across panes).
 */
export interface PaneUiState {
  isEditorReady: boolean;
  isApplyingProgrammaticUpdate: boolean;
  wikilinkAutocomplete: WikilinkAutocompleteState;
  slashMenu: PaneSlashMenuModel;
  selectionMenu: PaneSelectionMenuModel;
}

/**
 * DOM refs owned by the pane.
 */
export interface PaneDomRefs {
  paneCard: HTMLDivElement | null;
  editorShell: HTMLDivElement | null;
  editorRoot: HTMLDivElement | null;
  titleInput: HTMLInputElement | null;
  titleShell: HTMLDivElement | null;
}

/**
 * PaneRuntime owns pane-local state: DOM refs, editor controller,
 * readiness flags, cursor timer, slash menu, and wikilink autocomplete.
 */
export class PaneRuntime {
  paneId: NotepadPaneId;
  ui = $state<PaneUiState>({
    isEditorReady: false,
    isApplyingProgrammaticUpdate: false,
    wikilinkAutocomplete: createWikilinkAutocompleteState(),
    slashMenu: { open: false },
    selectionMenu: { open: false }
  });
  refs = $state<PaneDomRefs>({
    paneCard: null,
    editorShell: null,
    editorRoot: null,
    titleInput: null,
    titleShell: null
  });
  private _controller: EditorController | null = null;
  private _cursorSaveTimer: number | null = null;
  private _cursorSaveCallback: (() => void) | null = null;

  constructor(paneId: NotepadPaneId) {
    this.paneId = paneId;
  }

  get controller(): EditorController | null {
    return this._controller;
  }

  setController(value: EditorController | null): void {
    this._controller = value;
  }

  flushCursorSave(callback?: () => void): void {
    if (this._cursorSaveTimer) {
      window.clearTimeout(this._cursorSaveTimer);
      this._cursorSaveTimer = null;
    }
    const pendingCallback = this._cursorSaveCallback;
    this._cursorSaveCallback = null;
    (pendingCallback ?? callback)?.();
  }

  scheduleCursorSave(callback: () => void): void {
    if (this._cursorSaveTimer) {
      window.clearTimeout(this._cursorSaveTimer);
    }
    this._cursorSaveCallback = callback;
    this._cursorSaveTimer = window.setTimeout(() => {
      this._cursorSaveTimer = null;
      const pendingCallback = this._cursorSaveCallback;
      this._cursorSaveCallback = null;
      pendingCallback?.();
    }, 220);
  }

  setIsEditorReady(value: boolean): void {
    this.ui.isEditorReady = value;
  }

  setIsApplyingProgrammaticUpdate(value: boolean): void {
    this.ui.isApplyingProgrammaticUpdate = value;
  }

  setSlashMenu(snapshot: PaneSlashMenuModel): void {
    this.ui.slashMenu = snapshot;
  }

  setSelectionMenu(snapshot: PaneSelectionMenuModel): void {
    this.ui.selectionMenu = snapshot;
  }

  setWikilinkAutocomplete(state: WikilinkAutocompleteState): void {
    this.ui.wikilinkAutocomplete = state;
  }

  dispose(): void {
    if (this._cursorSaveTimer) {
      window.clearTimeout(this._cursorSaveTimer);
      this._cursorSaveTimer = null;
    }
    this._cursorSaveCallback = null;
  }
}
