/** Bound Markdown mounting work while allowing hidden native windows to finish. */
export function renderChatHistoryInBatches(
  total: number,
  alreadyRendered: number,
  render: (count: number) => void
) {
  let count = alreadyRendered;
  let cancelled = false;
  let cancelPending: (() => void) | undefined;

  function batch() {
    if (cancelled) return;
    count = Math.min(total, count + 8);
    render(count);
    if (count >= total || cancelled) return;

    // WKWebView may suspend animation frames while its window is hidden.
    // Keep readiness progressing without mounting the whole thread at once.
    let settled = false;
    let frame: number | undefined;
    const timer = setTimeout(advance, 50);
    function clearPending() {
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    }
    function advance() {
      if (settled) return;
      settled = true;
      clearPending();
      cancelPending = undefined;
      batch();
    }
    cancelPending = () => {
      settled = true;
      clearPending();
    };
    frame = requestAnimationFrame(advance);
  }

  batch();
  return () => {
    cancelled = true;
    cancelPending?.();
    cancelPending = undefined;
  };
}
