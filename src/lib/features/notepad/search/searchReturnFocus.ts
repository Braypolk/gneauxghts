export interface SearchReturnFocusTarget<TPaneId extends string> {
  paneId: TPaneId;
  /** Editor selection to restore, or null for a non-editor surface. */
  selection: { anchor: number; head: number } | null;
}

export interface SearchReturnFocusDeps<TPaneId extends string> {
  getActivePaneId: () => TPaneId;
  readPaneSelection: (
    paneId: TPaneId
  ) => { anchor: number; head: number } | null;
  activatePane: (paneId: TPaneId) => void;
  focusPaneSelection: (
    paneId: TPaneId,
    selection: { anchor: number; head: number }
  ) => boolean;
  focusPaneComposer: (paneId: TPaneId) => boolean;
}

/**
 * Remembers where the user was working when search opened so dismissing search
 * returns them there. Search itself moves the editor selection to preview
 * matches, so the position has to be captured before that happens and must not
 * be refreshed while the user is browsing results.
 */
export function createSearchReturnFocus<TPaneId extends string>(
  deps: SearchReturnFocusDeps<TPaneId>
) {
  let target: SearchReturnFocusTarget<TPaneId> | null = null;

  return {
    /**
     * Captures the current work location. Called once per closed-to-open
     * transition of the search bar, so overwriting any previous capture is
     * what keeps an abandoned one from going stale.
     */
    capture() {
      const paneId = deps.getActivePaneId();
      target = {
        paneId,
        selection: deps.readPaneSelection(paneId)
      };
    },
    /** Drops the capture without moving focus, e.g. after navigating away. */
    forget() {
      target = null;
    },
    /** Returns focus and selection to the captured location. */
    restore(): boolean {
      const captured = target;
      target = null;
      if (!captured) return false;

      deps.activatePane(captured.paneId);
      if (captured.selection) {
        return deps.focusPaneSelection(captured.paneId, captured.selection);
      }
      return deps.focusPaneComposer(captured.paneId);
    },
    /** Test/diagnostic read of the pending capture. */
    peek(): SearchReturnFocusTarget<TPaneId> | null {
      return target;
    }
  };
}

export type SearchReturnFocus<TPaneId extends string> = ReturnType<
  typeof createSearchReturnFocus<TPaneId>
>;
