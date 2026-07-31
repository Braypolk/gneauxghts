import type { PaneKind } from './paneTypes';

export type PaneTopAction =
  | 'open-chat'
  | 'open-previous'
  | 'split-pane'
  | 'split-with-chat'
  | 'split-with-previous'
  | 'split-with-current'
  | 'close';

export type SoloPaneTopAction = Exclude<PaneTopAction, 'close'>;
export type SplitPaneTopAction = Extract<
  PaneTopAction,
  'open-chat' | 'open-previous' | 'close'
>;

export type PaneLayout = 'solo' | 'split';
export type PaneActionPresentation = 'regular' | 'expanded';

const ACTIONS_BY_STATE: Readonly<
  Record<
    PaneLayout,
    Readonly<
      Record<
        PaneKind,
        Readonly<Record<PaneActionPresentation, readonly PaneTopAction[]>>
      >
    >
  >
> = {
  solo: {
    editor: {
      regular: ['open-chat', 'open-previous', 'split-pane'],
      expanded: [
        'split-with-chat',
        'split-with-previous',
        'split-with-current',
        'split-pane'
      ]
    },
    chat: {
      regular: ['open-previous', 'split-pane'],
      expanded: [
        'split-with-previous',
        'split-with-current',
        'split-pane'
      ]
    }
  },
  split: {
    editor: {
      regular: ['open-chat', 'open-previous', 'close'],
      expanded: ['open-chat', 'open-previous', 'close']
    },
    chat: {
      regular: ['open-previous', 'close'],
      expanded: ['open-previous', 'close']
    }
  }
};

/**
 * Canonical top-right pane controls for every pane/layout state.
 * Split panes have no expanded state; both presentations intentionally match.
 */
export function getPaneTopActions(
  paneKind: PaneKind,
  layout: 'solo',
  presentation?: PaneActionPresentation
): readonly SoloPaneTopAction[];
export function getPaneTopActions(
  paneKind: PaneKind,
  layout: 'split',
  presentation?: PaneActionPresentation
): readonly SplitPaneTopAction[];
export function getPaneTopActions(
  paneKind: PaneKind,
  layout: PaneLayout,
  presentation: PaneActionPresentation = 'regular'
): readonly PaneTopAction[] {
  return ACTIONS_BY_STATE[layout][paneKind][presentation];
}
