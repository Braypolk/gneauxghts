import type { EditorView } from '@codemirror/view';
import type { VirtualElement } from '@floating-ui/dom';

/** Follow a widget/handle when present, falling back to its editor text position. */
export function editorFloatingReference(view: EditorView, pos: number, element?: HTMLElement | null): VirtualElement {
  return {
    contextElement: view.contentDOM,
    getBoundingClientRect() {
      if (element?.isConnected) {
        const rect = element.getBoundingClientRect();
        if (rect.width >= 0.5 && rect.height >= 0.5) return rect;
      }
      const coords = view.coordsAtPos(Math.max(0, Math.min(pos, view.state.doc.length)));
      if (!coords) return view.dom.getBoundingClientRect();
      return new DOMRect(coords.left, coords.top, Math.max(1, coords.right - coords.left), Math.max(1, coords.bottom - coords.top));
    }
  };
}
