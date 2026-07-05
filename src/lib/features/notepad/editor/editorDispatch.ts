import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export function dispatchEditorChange(view: EditorView, spec: TransactionSpec) {
  view.dispatch(spec);
  view.focus();
  return true;
}
