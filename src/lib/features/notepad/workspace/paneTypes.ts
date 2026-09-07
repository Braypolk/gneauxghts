import type { DocumentHandle } from '$lib/features/notepad/state/noteStore';

export type PaneKind = 'editor' | 'chat';

export interface WorkspacePaneState<
  TPaneId extends string = string
> {
  paneId: TPaneId;
  kind: PaneKind;
  documentHandle: DocumentHandle;
  /** Chat identity is independent from the retained context note. */
  chatConversationId: string | null;
}

/**
 * The minimal workspace view needed by pane-role selectors.
 *
 * Keeping this read-only prevents selection policy from becoming another
 * owner of workspace state.
 */
export interface PaneSelectionState<TPaneId extends string> {
  paneOrder: readonly TPaneId[];
  activePaneId: TPaneId;
  getPaneKind: (paneId: TPaneId) => PaneKind;
}
