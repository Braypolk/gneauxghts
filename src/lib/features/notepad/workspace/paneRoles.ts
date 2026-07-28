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
 * editor when the active pane is a non-editor surface.
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
 * A pane owns its retained context. In particular, a chat pane's note binding
 * is explicit context, not an instruction to borrow from a nearby editor.
 */
export function getRetainedPaneContext<TPaneId extends string, TContext>(
  paneId: TPaneId,
  getPaneContext: (paneId: TPaneId) => TContext
): TContext {
  return getPaneContext(paneId);
}
