export interface PaneCloseAnimationDeps<TPaneId extends string> {
  beginCollapse: (paneId: TPaneId) => void;
  endCollapse: (paneId: TPaneId) => void;
  /** Resolves once the collapsing class has been applied to the DOM. */
  settle: () => Promise<void>;
  waitForMotion: () => Promise<void>;
  prefersReducedMotion: () => boolean;
}

/**
 * Collapses a pane before the workspace drops it, so the surviving pane grows
 * into the space instead of snapping from half width to full width in one
 * frame.
 */
export function createPaneCloseAnimation<TPaneId extends string>(
  deps: PaneCloseAnimationDeps<TPaneId>
) {
  return {
    async collapse(paneId: TPaneId): Promise<void> {
      // With reduced motion there is nothing to wait for, and stalling the
      // close by a fifth of a second would just make the app feel slower.
      if (deps.prefersReducedMotion()) return;
      deps.beginCollapse(paneId);
      await deps.settle();
      await deps.waitForMotion();
    },
    /**
     * Clears the collapsed layout. Called once the pane is gone, and also when
     * the close turns out to be stale or fails, which puts the pane back.
     */
    release(paneId: TPaneId): void {
      deps.endCollapse(paneId);
    }
  };
}

export type PaneCloseAnimation<TPaneId extends string> = ReturnType<
  typeof createPaneCloseAnimation<TPaneId>
>;
