/** Keep initial/responsive layout immediate while retaining deliberate UI transitions. */
export function suppressResizeTransitions(shell: HTMLElement) {
  let frame: number | undefined;

  function resize() {
    shell.setAttribute('data-window-resizing', '');
    if (frame !== undefined) cancelAnimationFrame(frame);
    // Keep the marker through a rendered frame so Svelte and ResizeObserver
    // can apply the new Related placement/reservation without starting motion.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        shell.removeAttribute('data-window-resizing');
        frame = undefined;
      });
    });
  }

  // The initial ResizeObserver measurement also changes Related placement and
  // gutters. Returning to the editor must not animate from those defaults.
  resize();

  // Suppress transitions before the window's layout-update/cancellation handlers.
  window.addEventListener('resize', resize, { capture: true });
  return {
    destroy() {
      window.removeEventListener('resize', resize, { capture: true });
      if (frame !== undefined) cancelAnimationFrame(frame);
      shell.removeAttribute('data-window-resizing');
    }
  };
}
