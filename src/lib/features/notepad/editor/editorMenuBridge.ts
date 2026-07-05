import type { EditorView } from '@codemirror/view';

export interface EditorMenuBridge<TSnapshot> {
  bindViewToPane: (view: EditorView, paneId: string) => void;
  unbindView: (view: EditorView) => void;
  getPaneIdForView: (view: EditorView) => string | undefined;
  setListener: (fn: ((view: EditorView, snapshot: TSnapshot) => void) | null) => void;
  emitUpdate: (view: EditorView, snapshot: TSnapshot) => void;
}

export function createEditorMenuBridge<TSnapshot>(): EditorMenuBridge<TSnapshot> {
  const viewToPaneId = new WeakMap<EditorView, string>();
  let listener: ((view: EditorView, snapshot: TSnapshot) => void) | null = null;

  return {
    bindViewToPane(view, paneId) {
      viewToPaneId.set(view, paneId);
    },
    unbindView(view) {
      viewToPaneId.delete(view);
    },
    getPaneIdForView(view) {
      return viewToPaneId.get(view);
    },
    setListener(fn) {
      listener = fn;
    },
    emitUpdate(view, snapshot) {
      listener?.(view, snapshot);
    }
  };
}
