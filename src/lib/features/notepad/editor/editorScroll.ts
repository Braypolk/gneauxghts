import { EditorSelection, StateEffect, type SelectionRange } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

interface ScrollRequest { position: number; end: number; scrollTop: number }

const requestScrollBand = StateEffect.define<ScrollRequest>({
  map: (request, changes) => ({ ...request,
    position: changes.mapPos(request.position), end: changes.mapPos(request.end) })
});

const scrollRequests = ViewPlugin.fromClass(class {
  target: ScrollRequest | null = null;
  generation = 0;

  update(update: ViewUpdate) {
    for (const transaction of update.transactions) {
      const request = transaction.effects.find(effect => effect.is(requestScrollBand));
      if (request) {
        this.target = request.value;
        this.generation++;
      } else if (transaction.scrollIntoView || transaction.selection || transaction.docChanged) {
        // A newer cursor/edit action supersedes a queued app destination.
        this.target = null;
        this.generation++;
      }
    }
  }
});

/** One policy for app destinations; native cursor motion and saved offsets stay separate. */
export const editorScrollExtension = [
  scrollRequests,
  EditorView.scrollHandler.of((view, range) => {
    const request = view.plugin(scrollRequests);
    if (!request || request.target?.position !== range.from) return false;
    const initialScrollTop = request.target.scrollTop;
    const end = request.target.end;
    request.target = null;
    const generation = request.generation;
    let alignment: 'start' | 'end' | 'inside' | null = null;
    // CodeMirror has rendered the destination. Measure in its next read phase,
    // after wrapped lines and decorations settle, rather than using height estimates.
    const measure = {
      key: request,
      read: (view: EditorView) => {
        if (request.generation !== generation) return null;
        const coords = view.coordsAtPos(range.from);
        if (!coords) return null;
        const scroller = view.scrollDOM;
        const port = scroller.getBoundingClientRect();
        let topInset = 0, bottomInset = 0;
        for (const source of view.state.facet(EditorView.scrollMargins)) {
          const margins = source(view);
          topInset = Math.max(topInset, margins?.top ?? 0);
          bottomInset = Math.max(bottomInset, margins?.bottom ?? 0);
        }
        const top = port.top + scroller.clientTop;
        const upper = top + Math.max(scroller.clientHeight * 0.2, topInset);
        const lower = top + Math.min(scroller.clientHeight * 0.6, scroller.clientHeight - bottomInset);
        const endCoords = end > range.from ? view.coordsAtPos(end, -1) : null;
        // Fit complete short matches, including wraps. A multi-screen passage
        // reveals its start rather than dragging the viewport to its far end.
        const bottom = endCoords && endCoords.bottom - coords.top <= lower - upper
          ? Math.max(coords.bottom, endCoords.bottom) : coords.bottom;
        // Rendering the target can anchor the scroll position before this read.
        // Choose the nearest boundary relative to the viewport the user started in.
        const anchored = scroller.scrollTop - initialScrollTop;
        alignment ??= coords.top + anchored < upper ? 'start'
          : bottom + anchored > lower ? 'end' : 'inside';
        const y = alignment === 'start' ? coords.top - upper
          : alignment === 'end' ? bottom - lower : -anchored;
        const left = port.left + scroller.clientLeft;
        const x = coords.left < left ? coords.left - left
          : coords.right > left + scroller.clientWidth ? coords.right - left - scroller.clientWidth : 0;
        return { x, y };
      },
      write: (delta: { x: number; y: number } | null, view: EditorView) => {
        if (!delta || request.generation !== generation) return;
        // The browser clamps to the available document extent.
        const before = view.scrollDOM.scrollTop;
        if (Math.abs(delta.y) > 1) view.scrollDOM.scrollTop += delta.y;
        if (Math.abs(delta.x) > 1) view.scrollDOM.scrollLeft += delta.x;
        // Scrolling can replace estimated long-line gaps with measured wraps.
        // Keep the original nearest boundary while that geometry settles.
        if (Math.abs(view.scrollDOM.scrollTop - before) > 1) view.requestMeasure(measure);
      }
    };
    view.requestMeasure(measure);
    return true;
  })
];

/** Reveal a destination with the least movement into the editor's 20–60% band. */
export function editorScrollEffect(view: EditorView, target: number | SelectionRange) {
  const position = typeof target === 'number' ? target : target.from;
  const end = typeof target === 'number' ? target : target.to;
  return [
    requestScrollBand.of({ position, end, scrollTop: view.scrollDOM.scrollTop }),
    EditorView.scrollIntoView(EditorSelection.cursor(position))
  ];
}
