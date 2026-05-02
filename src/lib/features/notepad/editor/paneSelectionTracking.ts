import { findCmContentElement } from '$lib/features/notepad/editor/editorDom';

const cmContentInteractionEvents = ['mouseup', 'touchend', 'focusout'] as const;

export interface PaneSelectionTrackingDeps<TPaneId extends string> {
  paneId: TPaneId;
  isEditorReady: boolean;
  editorRoot: HTMLDivElement | null;
  /** True when this pane is the active pane in editor mode. */
  isActivePaneInEditorMode: () => boolean;
  /** Persist the current cursor position. */
  persistCursorPosition: () => void;
  /** Push current selection's text upstream (for related-notes drawer). */
  updateSelectedRelatedText: () => void;
  /** Synchronous flush of any pending cursor save (called on teardown). */
  flushPendingCursorSave: () => void;
}

/**
 * Attach DOM listeners on the pane's CodeMirror content element to track
 * cursor / selection changes. Returns a teardown closure or undefined if
 * the editor isn't ready yet.
 *
 * Extracted from Notepad.svelte's inline attachPaneSelectionTracking to
 * keep the notepad component focused on orchestration.
 */
export function attachPaneSelectionTracking<TPaneId extends string>({
  isEditorReady,
  editorRoot,
  isActivePaneInEditorMode,
  persistCursorPosition,
  updateSelectedRelatedText,
  flushPendingCursorSave
}: PaneSelectionTrackingDeps<TPaneId>): (() => void) | undefined {
  if (!isEditorReady || !editorRoot) {
    return undefined;
  }

  const cmContent = findCmContentElement(editorRoot);
  if (!(cmContent instanceof HTMLElement)) {
    return undefined;
  }

  let selectionFrameId: number | null = null;
  const handleSelectionChange = () => {
    if (selectionFrameId !== null) {
      return;
    }

    selectionFrameId = window.requestAnimationFrame(() => {
      selectionFrameId = null;
      if (!isActivePaneInEditorMode()) {
        return;
      }
      updateSelectedRelatedText();
    });
  };

  const handleKeyboardSelectionChange = (event: KeyboardEvent) => {
    if (!event.shiftKey && !(event.metaKey && event.key.toLowerCase() === 'a')) {
      return;
    }
    handleSelectionChange();
  };

  for (const eventName of cmContentInteractionEvents) {
    cmContent.addEventListener(eventName, persistCursorPosition);
    cmContent.addEventListener(eventName, handleSelectionChange);
  }
  cmContent.addEventListener('keyup', handleKeyboardSelectionChange);

  return () => {
    if (selectionFrameId !== null) {
      window.cancelAnimationFrame(selectionFrameId);
    }
    flushPendingCursorSave();
    for (const eventName of cmContentInteractionEvents) {
      cmContent.removeEventListener(eventName, persistCursorPosition);
      cmContent.removeEventListener(eventName, handleSelectionChange);
    }
    cmContent.removeEventListener('keyup', handleKeyboardSelectionChange);
  };
}
