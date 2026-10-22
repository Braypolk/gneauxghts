import { EditorView } from '@codemirror/view';

/** Exercise browser-owned composition events against the real mounted pane. */
export function verifyTableCompositionRetirement() {
  const content = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content');
  const view = content && EditorView.findFromDOM(content);
  const input = document.activeElement;
  if (!view || !(input instanceof HTMLInputElement) || !input.classList.contains('gn-table-cell-input')) throw new Error('Focus a table input before testing composition');
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'stale preedit';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  const replacement = view.state.doc.toString().replace('**One**', 'external replacement');
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: replacement }, userEvent: 'input.external-reset' });
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur'));
  if (view.state.doc.toString() !== replacement) throw new Error('A stale composition overwrote external content');
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'unrelated replacement' }, userEvent: 'input.external-reset' });
  input.value = 'detached edit';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  if (view.state.doc.toString() !== 'unrelated replacement') throw new Error('A retired cell mutated a replacement document');
}
