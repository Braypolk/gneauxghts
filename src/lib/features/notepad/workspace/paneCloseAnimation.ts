/**
 * Mirrors `--pane-transition-duration` in src/app.css. The close sequence has
 * to know how long the collapse takes so the pane leaves the DOM only after it
 * finishes; CSS owns the curve, this owns the wait.
 */
export const PANE_TRANSITION_DURATION_MS = 220;

export interface PaneCloseAnimationDeps<TPaneId extends string> {
  beginCollapse: (paneId: TPaneId) => void;
  endCollapse: (paneId: TPaneId) => void;
  /** Resolves once the collapsing class has been applied to the DOM. */
  settle: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
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
      await deps.wait(PANE_TRANSITION_DURATION_MS);
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
