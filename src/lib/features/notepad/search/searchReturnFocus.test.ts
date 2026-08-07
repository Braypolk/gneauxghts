import { describe, expect, it, vi } from 'vitest';
import { createSearchReturnFocus } from './searchReturnFocus';

type PaneId = 'primary' | 'secondary';

function harness(
  overrides: {
    activePaneId?: PaneId;
    selections?: Partial<Record<PaneId, { anchor: number; head: number } | null>>;
  } = {}
) {
  let activePaneId: PaneId = overrides.activePaneId ?? 'primary';
  const selections: Record<PaneId, { anchor: number; head: number } | null> = {
    primary: { anchor: 12, head: 20 },
    secondary: null,
    ...overrides.selections
  };

  const activatePane = vi.fn((paneId: PaneId) => {
    activePaneId = paneId;
  });
  const focusPaneSelection = vi.fn(() => true);
  const focusPaneComposer = vi.fn(() => true);

  const returnFocus = createSearchReturnFocus<PaneId>({
    getActivePaneId: () => activePaneId,
    readPaneSelection: (paneId) => selections[paneId],
    activatePane,
    focusPaneSelection,
    focusPaneComposer
  });

  return {
    returnFocus,
    activatePane,
    focusPaneSelection,
    focusPaneComposer,
    setActivePaneId(paneId: PaneId) {
      activePaneId = paneId;
    },
    setSelection(paneId: PaneId, selection: { anchor: number; head: number } | null) {
      selections[paneId] = selection;
    }
  };
}

describe('createSearchReturnFocus', () => {
  it('restores the editor selection captured before search moved it', () => {
    const h = harness();

    h.returnFocus.capture();
    // Browsing matches moves the live selection; the capture must not follow.
    h.setSelection('primary', { anchor: 400, head: 407 });

    expect(h.returnFocus.restore()).toBe(true);
    expect(h.activatePane).toHaveBeenCalledWith('primary');
    expect(h.focusPaneSelection).toHaveBeenCalledWith('primary', {
      anchor: 12,
      head: 20
    });
    expect(h.focusPaneComposer).not.toHaveBeenCalled();
  });

  it('returns to the pane that was active when search opened', () => {
    const h = harness({ activePaneId: 'primary' });

    h.returnFocus.capture();
    h.setActivePaneId('secondary');

    h.returnFocus.restore();

    expect(h.activatePane).toHaveBeenCalledWith('primary');
  });

  it('focuses the composer when the captured pane has no editor selection', () => {
    const h = harness({ activePaneId: 'secondary' });

    h.returnFocus.capture();

    expect(h.returnFocus.restore()).toBe(true);
    expect(h.focusPaneComposer).toHaveBeenCalledWith('secondary');
    expect(h.focusPaneSelection).not.toHaveBeenCalled();
  });

  it('does nothing when there is no capture to return to', () => {
    const h = harness();

    expect(h.returnFocus.restore()).toBe(false);
    expect(h.activatePane).not.toHaveBeenCalled();
  });

  it('consumes the capture so a later dismissal cannot reuse it', () => {
    const h = harness();

    h.returnFocus.capture();
    h.returnFocus.restore();

    expect(h.returnFocus.restore()).toBe(false);
    expect(h.focusPaneSelection).toHaveBeenCalledTimes(1);
  });

  it('drops the capture when a destination takes over focus', () => {
    const h = harness();

    h.returnFocus.capture();
    h.returnFocus.forget();

    expect(h.returnFocus.restore()).toBe(false);
    expect(h.focusPaneSelection).not.toHaveBeenCalled();
  });

  it('recaptures on a later open instead of keeping an abandoned position', () => {
    const h = harness();

    h.returnFocus.capture();
    h.setSelection('primary', { anchor: 90, head: 90 });
    h.returnFocus.capture();

    h.returnFocus.restore();

    expect(h.focusPaneSelection).toHaveBeenCalledWith('primary', {
      anchor: 90,
      head: 90
    });
  });
});
