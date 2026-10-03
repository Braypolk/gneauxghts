import { forceParsing, syntaxTreeAvailable } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

export function nextEditorFrame() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      resolve();
      return;
    }
    // Native frame callbacks can stop while the window is hidden. Keep lifecycle
    // cancellation and queued teardown moving even in that case.
    let settled = false;
    let frame = 0;
    const fallback = setTimeout(finish, 50);
    frame = requestAnimationFrame(finish);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      resolve();
    }
  });
}

/** Format and measure the restored viewport while its editor remains hidden. */
export async function settleEditorPresentation(
  view: EditorView,
  isCurrent: () => boolean,
  {
    scrollTop,
    scrollSelectionIntoView = false
  }: { scrollTop?: number; scrollSelectionIntoView?: boolean } = {}
): Promise<boolean> {
  if (!isCurrent()) return false;
  // Allow the mounted shell's chrome inset to be published before measuring.
  // After that, public geometry reads can settle CodeMirror synchronously.
  await nextEditorFrame();
  let sliceStarted = performance.now();
  while (isCurrent()) {
    // Layout first admits the restored selection/scroll into the real viewport.
    // Parsing in bounded slices avoids a synchronous whole-note parse on load.
    if (typeof scrollTop === 'number') {
      view.scrollDOM.scrollTop = Math.min(
        scrollTop,
        Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
      );
    }
    const before = measureViewport(view);

    const parseTo = Math.max(
      view.viewport.to,
      scrollSelectionIntoView ? view.state.selection.main.to : 0
    );
    if (!forceParsing(view, parseTo, Math.max(1, 12 - (performance.now() - sliceStarted)))) {
      await nextEditorFrame();
      sliceStarted = performance.now();
      continue;
    }
    // Parsing publishes decorations synchronously, but their line heights and
    // scroll anchoring settle in the following CodeMirror measurement.
    if (scrollSelectionIntoView) {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main) });
    }
    const after = measureViewport(view);
    const { scrollDOM, viewport } = view;
    const targetReached = typeof scrollTop !== 'number' || Math.abs(
      scrollDOM.scrollTop - Math.min(
        scrollTop, Math.max(0, scrollDOM.scrollHeight - scrollDOM.clientHeight)
      )
    ) < 1;
    if (syntaxTreeAvailable(view.state, viewport.to) && targetReached && before === after) {
      return isCurrent();
    }
    // Retry changed geometry immediately while this slice has time left. Large
    // notes still yield between bounded slices so navigation stays responsive.
    if (performance.now() - sliceStarted >= 12) {
      await nextEditorFrame();
      sliceStarted = performance.now();
    }
  }
  return false;
}

function measureViewport(view: EditorView) {
  view.requestMeasure();
  // This supported geometry read flushes pending decoration/layout measurements
  // and scroll anchoring, including when native animation frames are suspended.
  view.coordsAtPos(view.viewport.from);
  const { scrollDOM, viewport } = view;
  return [
    viewport.from, viewport.to, scrollDOM.scrollTop,
    scrollDOM.scrollHeight, scrollDOM.clientHeight
  ].join(':');
}
