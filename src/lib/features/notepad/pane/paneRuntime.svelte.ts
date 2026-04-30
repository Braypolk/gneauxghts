import type { EditorController } from '$lib/features/notepad/editor/editor';
import type { PaneSlashMenuModel } from '$lib/features/notepad/editor/SlashMenu.svelte';
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
  isApplyingExternalContent: boolean;
  wikilinkAutocomplete: WikilinkAutocompleteState;
  editorGeneration: number;
  slashMenu: PaneSlashMenuModel;
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
    isApplyingExternalContent: false,
    wikilinkAutocomplete: createWikilinkAutocompleteState(),
    editorGeneration: 0,
    slashMenu: { open: false }
  });
  refs = $state<PaneDomRefs>({
    paneCard: null,
    editorShell: null,
    editorRoot: null,
    titleInput: null,
    titleShell: null
  });
  private _controller: EditorController | null = null;
  private _cursorSaveTimer: ReturnType<typeof window.setTimeout> | null = null;
  private _openRequestGeneration = 0;

  constructor(paneId: NotepadPaneId) {
    this.paneId = paneId;
  }

  get controller(): EditorController | null {
    return this._controller;
  }

  setController(value: EditorController | null): void {
    this._controller = value;
  }

  flushCursorSave(callback: () => void): void {
    if (this._cursorSaveTimer) {
      window.clearTimeout(this._cursorSaveTimer);
      this._cursorSaveTimer = null;
    }
    callback();
  }

  scheduleCursorSave(callback: () => void): void {
    if (this._cursorSaveTimer) {
      window.clearTimeout(this._cursorSaveTimer);
    }
    this._cursorSaveTimer = window.setTimeout(() => {
      this._cursorSaveTimer = null;
      callback();
    }, 220);
  }

  bumpOpenRequestGeneration(): number {
    this._openRequestGeneration += 1;
    return this._openRequestGeneration;
  }

  getOpenRequestGeneration(): number {
    return this._openRequestGeneration;
  }

  setIsEditorReady(value: boolean): void {
    this.ui.isEditorReady = value;
  }

  setIsApplyingExternalContent(value: boolean): void {
    this.ui.isApplyingExternalContent = value;
  }

  setSlashMenu(snapshot: PaneSlashMenuModel): void {
    this.ui.slashMenu = snapshot;
  }

  setWikilinkAutocomplete(state: WikilinkAutocompleteState): void {
    this.ui.wikilinkAutocomplete = state;
  }

  dispose(): void {
    if (this._cursorSaveTimer) {
      window.clearTimeout(this._cursorSaveTimer);
      this._cursorSaveTimer = null;
    }
  }
}
