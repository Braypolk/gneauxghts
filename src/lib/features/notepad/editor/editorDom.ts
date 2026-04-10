import type { EditorView } from 'prosemirror-view';

type QueryRoot = Element | Document | DocumentFragment | null;

export function findProseMirrorElement(root: QueryRoot) {
  if (root instanceof HTMLElement && root.classList.contains('ProseMirror')) {
    return root;
  }

  const proseMirror = root?.querySelector('.ProseMirror');
  return proseMirror instanceof HTMLElement ? proseMirror : null;
}

export function getEditorProseSurface(view: EditorView) {
  return findProseMirrorElement(view.dom) ?? (view.dom as HTMLElement);
}
