import { EditorView, RectangleMarker, layer } from '@codemirror/view';

/**
 * WebKit sizes its native caret from the line box after a soft wrap, including
 * leading (https://bugs.webkit.org/show_bug.cgi?id=287429). Measure cursors from
 * CodeMirror's text coordinates instead, so typography and wrapping can vary.
 *
 * Keep native range selection: drawSelection() also moves selection backgrounds
 * behind the content, where our opaque Markdown block backgrounds hide them.
 */
export function createCursorExtension() {
  return [
    EditorView.theme({
      '.cm-content, .cm-line': { caretColor: 'transparent !important' },
      '.cm-content :focus': { caretColor: 'auto !important' }
    }),
    layer({
      above: true,
      class: 'cm-cursorLayer',
      markers(view) {
        return view.state.selection.ranges.flatMap(range =>
          range.empty
            ? RectangleMarker.forRange(
                view,
                range === view.state.selection.main
                  ? 'cm-cursor cm-cursor-primary'
                  : 'cm-cursor cm-cursor-secondary',
                range
              )
            : []
        );
      },
      update(update, dom) {
        if (update.selectionSet || update.docChanged || update.focusChanged) {
          // Restart CodeMirror's blink animation after typing or navigation.
          dom.style.animationName =
            dom.style.animationName === 'cm-blink' ? 'cm-blink2' : 'cm-blink';
          return true;
        }
        return false;
      }
    })
  ];
}
