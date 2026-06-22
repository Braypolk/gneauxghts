import { keyboardShortcutMatchesEvent } from '$lib/keyboardShortcuts';

export interface WorkspaceShortcutDeps<TPaneId extends string> {
  getPaneOrder: () => TPaneId[];
  getActivePaneId: () => TPaneId;
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  splitWorkspace: () => Promise<void>;
  closePane: (paneId: TPaneId) => Promise<void>;
  switchActivePane: () => Promise<void>;
  rememberCurrentNote: () => Promise<void>;
  toggleRelatedPanel: () => void;
  openRecentNoteByIndex: (index: number) => void | Promise<void>;
  requestSearchFocus: (mode: 'all' | 'current') => void;
  focusPaneAfterShortcut: (paneId: TPaneId, options?: { preferTitle?: boolean }) => void;
  /** Splitting-picker keydown branch — return true if handled. */
  handleSplitPickerGlobalKeydown: (event: KeyboardEvent) => boolean;
  /** Wikilink keydown branch — return true if handled. */
  handleWikilinkKeydown: (event: KeyboardEvent) => boolean;
}

/**
 * Owns the global keyboard-shortcut dispatch table that previously lived
 * inline in Notepad.svelte's handleGlobalKeydown. Returns a single
 * function suitable for `<svelte:window onkeydowncapture={...} />`.
 */
export function createWorkspaceShortcutHandler<TPaneId extends string>(
  deps: WorkspaceShortcutDeps<TPaneId>
) {
  return async function handleGlobalKeydown(event: KeyboardEvent): Promise<void> {
    if (deps.handleWikilinkKeydown(event)) {
      return;
    }

    if (deps.handleSplitPickerGlobalKeydown(event)) {
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'splitWorkspace')) {
      if (event.repeat || deps.getPaneOrder().length > 1) {
        return;
      }

      const activePaneId = deps.getActivePaneId();
      const preferTitle = document.activeElement === deps.getPaneTitleInput(activePaneId);
      event.preventDefault();
      await deps.splitWorkspace();
      deps.focusPaneAfterShortcut(deps.getActivePaneId(), { preferTitle });
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'closePane')) {
      if (event.repeat || deps.getPaneOrder().length < 2) {
        return;
      }

      const activePaneId = deps.getActivePaneId();
      const preferTitle = document.activeElement === deps.getPaneTitleInput(activePaneId);
      event.preventDefault();
      await deps.closePane(activePaneId);
      deps.focusPaneAfterShortcut(deps.getActivePaneId(), { preferTitle });
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'rememberCurrentNote')) {
      if (event.repeat) {
        return;
      }

      event.preventDefault();
      await deps.rememberCurrentNote();
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'switchPane')) {
      if (event.repeat || deps.getPaneOrder().length < 2) {
        return;
      }

      event.preventDefault();
      await deps.switchActivePane();
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'toggleRelatedPanel')) {
      event.preventDefault();
      deps.toggleRelatedPanel();
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'goToPreviousNote')) {
      event.preventDefault();
      void deps.openRecentNoteByIndex(0);
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'searchAll')) {
      event.preventDefault();
      deps.requestSearchFocus('all');
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'searchCurrent')) {
      event.preventDefault();
      deps.requestSearchFocus('current');
    }
  };
}
