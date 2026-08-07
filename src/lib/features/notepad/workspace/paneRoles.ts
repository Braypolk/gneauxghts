import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type {
  PaneKind,
  PaneSelectionState
} from './paneTypes';
import {
  getNearestPaneIdWithCapability,
  paneHasCapability
} from './paneCapabilities';

export function getNearestEditorPaneId<TPaneId extends string>(
  paneOrder: readonly TPaneId[],
  getPaneKind: (paneId: TPaneId) => PaneKind,
  fromPaneId: TPaneId
): TPaneId | null {
  return getNearestPaneIdWithCapability(
    paneOrder,
    getPaneKind,
    fromPaneId,
    'edit-document'
  );
}

/**
 * Generic note navigation stays in the active editor, or targets the nearest
 * editor when the active pane is a non-editor surface. If no editor is visible,
 * it reuses the active retained-context pane; the open-note transition reveals
 * that pane's editor after loading the target.
 */
export function getNavigationPaneId<TPaneId extends string>(
  state: PaneSelectionState<TPaneId>
): TPaneId {
  if (
    paneHasCapability(
      state.getPaneKind(state.activePaneId),
      'edit-document'
    )
  ) {
    return state.activePaneId;
  }
  return (
    getNearestEditorPaneId(
      state.paneOrder,
      state.getPaneKind,
      state.activePaneId
    ) ?? state.activePaneId
  );
}

/**
 * Chat context follows the editor the chat pane sits beside, so what the user
 * reads and what the chat reasons about cannot disagree. A chat pane with no
 * visible editor falls back to its own retained note, which is also its route
 * back to editing.
 */
export function getChatContextPaneId<TPaneId extends string>(
  paneOrder: readonly TPaneId[],
  getPaneKind: (paneId: TPaneId) => PaneKind,
  paneId: TPaneId
): TPaneId {
  return (
    getNearestEditorPaneId(paneOrder, getPaneKind, paneId) ?? paneId
  );
}

/**
 * When an editor that was feeding chat context is about to leave (closed, or
 * switched to chat itself), copy its document onto every chat pane that was
 * following it. Otherwise those chats fall back to a stale retain from when
 * they were first opened.
 */
export function adoptChatContextFromLeavingEditor<TPaneId extends string>(
  paneOrder: readonly TPaneId[],
  getPaneKind: (paneId: TPaneId) => PaneKind,
  leavingPaneId: TPaneId,
  leavingDocument: NoteDraftState,
  setPaneDocument: (paneId: TPaneId, document: NoteDraftState) => void
) {
  if (!paneHasCapability(getPaneKind(leavingPaneId), 'edit-document')) {
    return;
  }

  for (const paneId of paneOrder) {
    if (paneId === leavingPaneId) continue;
    if (!paneHasCapability(getPaneKind(paneId), 'host-chat')) continue;
    if (
      getChatContextPaneId(paneOrder, getPaneKind, paneId) !==
      leavingPaneId
    ) {
      continue;
    }
    setPaneDocument(paneId, leavingDocument);
  }
}
