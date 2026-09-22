/**
 * The chrome above a note (the pane's title row, plus the nav pill once it
 * stops taking flow height on narrow widths) floats over the editor, so the
 * first line has to be pushed down by however tall that chrome actually is.
 * Hand-tuned constants only fit the breakpoint they were measured at: they left
 * the first line ~5px below the title row on narrow windows and ignored
 * `env(safe-area-inset-top)` entirely.
 *
 * Measuring in real coordinates covers both, because safe-area insets and a
 * floating nav bar are already part of the geometry.
 */

const OVERLAY_SELECTOR = '.notepad-editor-top-overlay';
const NAV_SELECTOR = '.app-navigation-header';

export function measureEditorChromeInset(
  editorShell: HTMLElement,
  overlay: HTMLElement | null,
  nav: HTMLElement | null
) {
  const shellTop = editorShell.getBoundingClientRect().top;
  let inset = 0;
  for (const element of [overlay, nav]) {
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    // A nav bar that still takes flow height sits above the shell entirely, so
    // its overhang is negative and max() ignores it.
    inset = Math.max(inset, rect.bottom - shellTop);
  }
  return Math.round(inset);
}

/**
 * Publishes the measured overhang as `--editor-overlay-inset` on the editor
 * shell, where the padding tokens are composed.
 */
export function editorChromeInset(editorShell: HTMLElement) {
  const pane = editorShell.closest('[role="group"]');
  let frame = 0;
  let lastInset: number | undefined;

  function resolveOverlay() {
    return pane?.querySelector<HTMLElement>(OVERLAY_SELECTOR) ?? null;
  }

  function resolveNav() {
    return document.querySelector<HTMLElement>(NAV_SELECTOR);
  }

  function write() {
    frame = 0;
    const inset = measureEditorChromeInset(
      editorShell,
      resolveOverlay(),
      resolveNav()
    );
    if (inset === lastInset) return;
    lastInset = inset;
    editorShell.style.setProperty(
      '--editor-overlay-inset',
      `${inset}px`
    );
  }

  function schedule() {
    if (frame !== 0) return;
    frame = window.requestAnimationFrame(write);
  }

  schedule();

  const observer = new ResizeObserver(schedule);
  observer.observe(editorShell);
  const overlay = resolveOverlay();
  if (overlay) observer.observe(overlay);
  const nav = resolveNav();
  if (nav) observer.observe(nav);
  window.addEventListener('resize', schedule);

  return {
    destroy() {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      editorShell.style.removeProperty('--editor-overlay-inset');
    }
  };
}
