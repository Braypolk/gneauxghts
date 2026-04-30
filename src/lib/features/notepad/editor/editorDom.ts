import { EditorView } from '@codemirror/view';

type QueryRoot = Element | Document | DocumentFragment | null;

/** Resolves the CodeMirror 6 editable surface (`.cm-content`) under `root`, if present. */
export function findCmContentElement(root: QueryRoot) {
  if (root instanceof HTMLElement && root.classList.contains('cm-content')) {
    return root;
  }

  const content = root?.querySelector('.cm-content');
  return content instanceof HTMLElement ? content : null;
}

/** Content DOM for layout/focus; prefers the `.cm-content` element inside `view.dom`. */
export function getEditorContentSurface(view: EditorView) {
  return findCmContentElement(view.dom) ?? view.contentDOM;
}
