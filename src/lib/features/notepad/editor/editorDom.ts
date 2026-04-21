import { EditorView } from '@codemirror/view';

type QueryRoot = Element | Document | DocumentFragment | null;

export function findProseMirrorElement(root: QueryRoot) {
  if (root instanceof HTMLElement && root.classList.contains('cm-content')) {
    return root;
  }

  const content = root?.querySelector('.cm-content');
  return content instanceof HTMLElement ? content : null;
}

export function getEditorProseSurface(view: EditorView) {
  return findProseMirrorElement(view.dom) ?? view.contentDOM;
}
