/** Keep the shell inside the visual viewport. Its children must not subtract
 * keyboard height again: their containing block already ends above it. */
export function mobileViewport(node: HTMLElement) {
  let animationFrameId = 0;
  const viewport = window.visualViewport;
  const touchMedia = window.matchMedia('(any-pointer: coarse)');
  const root = document.documentElement;
  const properties = ['--app-viewport-height', '--app-viewport-top'] as const;
  const previous = properties.map(property => root.style.getPropertyValue(property));
  const previousKeyboard = root.dataset.keyboardOpen;

  function writeMetrics() {
    animationFrameId = 0;
    const visual = window.visualViewport;
    const touch = touchMedia.matches;
    const height = Math.round(visual?.height ?? window.innerHeight);
    const top = Math.round(visual?.offsetTop ?? 0);
    // Compare with the layout viewport, not a remembered maximum. Rotation
    // and mounting with the keyboard already visible must work immediately.
    const keyboardOpen = touch && (visual?.scale ?? 1) === 1
      && window.innerHeight - height - top > 80;
    node.dataset.mobileViewport = String(touch);
    node.dataset.keyboardOpen = String(keyboardOpen);
    root.dataset.keyboardOpen = String(keyboardOpen);
    node.style.setProperty('--keyboard-inset-height', '0px');
    if (touch) {
      node.style.setProperty('--app-shell-height', `${height}px`);
      node.style.setProperty('--app-viewport-top', `${top}px`);
      root.style.setProperty('--app-viewport-height', `${height}px`);
      root.style.setProperty('--app-viewport-top', `${top}px`);
    } else {
      node.style.removeProperty('--app-shell-height');
      node.style.removeProperty('--app-viewport-top');
      properties.forEach((property, index) => {
        if (previous[index]) root.style.setProperty(property, previous[index]);
        else root.style.removeProperty(property);
      });
    }
  }

  function scheduleMetricsWrite() {
    if (animationFrameId === 0) animationFrameId = window.requestAnimationFrame(writeMetrics);
  }

  scheduleMetricsWrite();
  touchMedia.addEventListener('change', scheduleMetricsWrite);
  window.addEventListener('resize', scheduleMetricsWrite);
  window.addEventListener('orientationchange', scheduleMetricsWrite);
  viewport?.addEventListener('resize', scheduleMetricsWrite);
  viewport?.addEventListener('scroll', scheduleMetricsWrite);

  return {
    destroy() {
      if (animationFrameId !== 0) window.cancelAnimationFrame(animationFrameId);
      touchMedia.removeEventListener('change', scheduleMetricsWrite);
      window.removeEventListener('resize', scheduleMetricsWrite);
      window.removeEventListener('orientationchange', scheduleMetricsWrite);
      viewport?.removeEventListener('resize', scheduleMetricsWrite);
      viewport?.removeEventListener('scroll', scheduleMetricsWrite);
      for (const property of ['--app-shell-height', '--keyboard-inset-height', '--app-viewport-top']) {
        node.style.removeProperty(property);
      }
      properties.forEach((property, index) => {
        if (previous[index]) root.style.setProperty(property, previous[index]);
        else root.style.removeProperty(property);
      });
      if (previousKeyboard === undefined) delete root.dataset.keyboardOpen;
      else root.dataset.keyboardOpen = previousKeyboard;
      delete node.dataset.keyboardOpen;
      delete node.dataset.mobileViewport;
    }
  };
}
