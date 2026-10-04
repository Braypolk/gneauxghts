import { describe, expect, it } from 'vitest';
import {
  PANE_TRANSIENT_UI_KINDS,
  transitionPaneTransientUi,
  type PaneTransientUiAction,
  type PaneTransientUiState
} from './paneTransientUiState';

type PaneId = 'left' | 'right';

const session = { images: [], index: 0, load: async () => '', subscribe: () => () => {}, restore: () => {} };
function openAction(kind: typeof PANE_TRANSIENT_UI_KINDS[number], paneId: PaneId): PaneTransientUiAction<PaneId> {
  return kind === 'image-viewer' ? { type: 'open-image-viewer', paneId, session } : { type: 'open', kind, paneId };
}
const states: PaneTransientUiState<PaneId>[] = [
  { kind: 'none' },
  { kind: 'image-viewer', paneId: 'left', session },
  { kind: 'slash-menu', paneId: 'left' },
  { kind: 'selection-menu', paneId: 'left' },
  { kind: 'wikilink-autocomplete', paneId: 'left' }
];

describe('pane transient UI state', () => {
  it.each(['slash-menu', 'image-viewer'] as const)(
    'opening %s replaces every possible prior state',
    (kind) => {
      for (const previous of states) {
        expect(
          transitionPaneTransientUi(previous, openAction(kind, 'right'))
        ).toEqual({
          kind,
          paneId: 'right',
          ...(kind === 'image-viewer' ? { session } : {})
        });
      }
    }
  );

  it.each(['slash-menu'] as const)(
    'closing %s clears only that surface and owner',
    (kind) => {
      const open = transitionPaneTransientUi(
        { kind: 'none' },
        openAction(kind, 'left')
      );

      expect(
        transitionPaneTransientUi(open, {
          type: 'close',
          kind
        })
      ).toEqual({ kind: 'none' });
      expect(
        transitionPaneTransientUi(open, {
          type: 'close',
          kind,
          paneId: 'right'
        })
      ).toBe(open);

      for (const otherKind of PANE_TRANSIENT_UI_KINDS) {
        if (otherKind === kind) continue;
        expect(
          transitionPaneTransientUi(open, {
            type: 'close',
            kind: otherKind
          })
        ).toBe(open);
      }
    }
  );
});
