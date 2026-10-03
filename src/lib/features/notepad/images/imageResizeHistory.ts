import { EditorState, StateField } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';

// This runs on the document's existing undo root. Keep a repeated sizing burst
// separate from adjacent typing while allowing CodeMirror's normal 500ms grouping.
const resizing = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    return transaction.docChanged ? transaction.isUserEvent('input.type.image.resize') : value;
  }
});
export const imageResizeHistory = [resizing, EditorState.transactionExtender.of(transaction => {
  if (!transaction.docChanged) return null;
  const current = transaction.isUserEvent('input.type.image.resize');
  return current !== transaction.startState.field(resizing)
    ? { annotations: isolateHistory.of('before') } : null;
})];
