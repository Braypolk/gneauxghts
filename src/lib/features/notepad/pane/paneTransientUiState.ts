import type { ImageViewerSession } from '../images/imageViewerModel';
import type { ExternalLinkActionsSession } from '../editor/externalLinkExtension';
export const PANE_TRANSIENT_UI_KINDS = [
  'slash-menu',
  'selection-menu',
  'wikilink-autocomplete',
  'image-viewer',
  'external-link-actions'
] as const;

export type PaneTransientUiKind =
  (typeof PANE_TRANSIENT_UI_KINDS)[number];

/**
 * Exactly one pane-owned transient surface may be active. Encoding that
 * invariant as a discriminated union makes conflicting combinations
 * unrepresentable.
 */
export type PaneTransientUiState<TPaneId extends string> =
  | { kind: 'none' }
  | { kind: 'image-viewer'; paneId: TPaneId; session: ImageViewerSession }
  | { kind: 'external-link-actions'; paneId: TPaneId; session: ExternalLinkActionsSession }
  | {
      kind: 'slash-menu';
      paneId: TPaneId;
    }
  | {
      kind: 'selection-menu';
      paneId: TPaneId;
    }
  | {
      kind: 'wikilink-autocomplete';
      paneId: TPaneId;
    };

export type PaneTransientUiAction<TPaneId extends string> =
  | {
      type: 'open';
      kind: Exclude<PaneTransientUiKind, 'image-viewer' | 'external-link-actions'>;
      paneId: TPaneId;
    }
  | { type: 'open-image-viewer'; paneId: TPaneId; session: ImageViewerSession }
  | { type: 'open-external-link-actions'; paneId: TPaneId; session: ExternalLinkActionsSession }
  | {
      type: 'close';
      kind: PaneTransientUiKind;
      paneId?: TPaneId | null;
    };

export function transitionPaneTransientUi<
  TPaneId extends string
>(
  state: PaneTransientUiState<TPaneId>,
  action: PaneTransientUiAction<TPaneId>
): PaneTransientUiState<TPaneId> {
  if (action.type === 'open-image-viewer') return { kind: 'image-viewer', paneId: action.paneId, session: action.session };
  if (action.type === 'open-external-link-actions') return { kind: 'external-link-actions', paneId: action.paneId, session: action.session };
  if (action.type === 'open') {
    return {
      kind: action.kind,
      paneId: action.paneId
    };
  }
  if (
    state.kind !== action.kind ||
    (action.paneId != null &&
      state.paneId !== action.paneId)
  ) {
    return state;
  }
  return { kind: 'none' };
}
