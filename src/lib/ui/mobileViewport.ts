export function mobileViewport(node: HTMLElement) {
  let animationFrameId = 0;
  let maxViewportHeight = 0;
  let lastViewportWidth = 0;
  let lastOrientation = '';

  function getOrientation() {
    return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
  }

  function writeMetrics() {
    animationFrameId = 0;

    const visualViewport = window.visualViewport;
    const viewportHeight = Math.round(visualViewport?.height ?? window.innerHeight);
    const viewportOffsetTop = Math.round(visualViewport?.offsetTop ?? 0);
    const viewportWidth = Math.round(visualViewport?.width ?? window.innerWidth);
    const orientation = getOrientation();
    const viewportBottom = viewportHeight + viewportOffsetTop;

    if (
      maxViewportHeight === 0
      || (lastViewportWidth !== 0 && Math.abs(viewportWidth - lastViewportWidth) > 120)
      || (lastOrientation !== '' && orientation !== lastOrientation)
    ) {
      maxViewportHeight = viewportBottom;
    } else {
      maxViewportHeight = Math.max(maxViewportHeight, viewportBottom);
    }

    const rawKeyboardInset = Math.max(0, maxViewportHeight - viewportBottom);
    const keyboardInset = rawKeyboardInset > 80 ? rawKeyboardInset : 0;

    node.style.setProperty('--app-shell-height', `${maxViewportHeight}px`);
    node.style.setProperty('--keyboard-inset-height', `${keyboardInset}px`);
    node.dataset.keyboardOpen = keyboardInset > 0 ? 'true' : 'false';

    lastViewportWidth = viewportWidth;
    lastOrientation = orientation;
  }

  function scheduleMetricsWrite() {
    if (animationFrameId !== 0) {
      return;
    }

    animationFrameId = window.requestAnimationFrame(writeMetrics);
  }

  scheduleMetricsWrite();

  window.addEventListener('resize', scheduleMetricsWrite);
  window.addEventListener('orientationchange', scheduleMetricsWrite);
  window.visualViewport?.addEventListener('resize', scheduleMetricsWrite);
  window.visualViewport?.addEventListener('scroll', scheduleMetricsWrite);

  return {
    destroy() {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }

      window.removeEventListener('resize', scheduleMetricsWrite);
      window.removeEventListener('orientationchange', scheduleMetricsWrite);
      window.visualViewport?.removeEventListener('resize', scheduleMetricsWrite);
      window.visualViewport?.removeEventListener('scroll', scheduleMetricsWrite);

      node.style.removeProperty('--app-shell-height');
      node.style.removeProperty('--keyboard-inset-height');
      delete node.dataset.keyboardOpen;
    }
  };
}
