import { describe, expect, it } from 'vitest';
import {
  PANE_TRANSIENT_UI_KINDS,
  transitionPaneTransientUi,
  type PaneTransientUiState
} from './paneTransientUiState';

type PaneId = 'left' | 'right';

const states: PaneTransientUiState<PaneId>[] = [
  { kind: 'none' },
  { kind: 'slash-menu', paneId: 'left' },
  { kind: 'selection-menu', paneId: 'left' },
  { kind: 'wikilink-autocomplete', paneId: 'left' }
];

describe('pane transient UI state', () => {
  it.each(PANE_TRANSIENT_UI_KINDS)(
    'opening %s replaces every possible prior state',
    (kind) => {
      for (const previous of states) {
        expect(
          transitionPaneTransientUi(previous, {
            type: 'open',
            kind,
            paneId: 'right'
          })
        ).toEqual({
          kind,
          paneId: 'right'
        });
      }
    }
  );

  it.each(PANE_TRANSIENT_UI_KINDS)(
    'closing %s clears only that surface and owner',
    (kind) => {
      const open = transitionPaneTransientUi(
        { kind: 'none' },
        { type: 'open', kind, paneId: 'left' }
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
