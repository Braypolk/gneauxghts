import { EditorView } from '@codemirror/view';

/** Reveal a canonical line before testing the browser's actual pointer mapping. */
export function revealTableTestText(text: string) {
  const content = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content');
  const view = content && EditorView.findFromDOM(content);
  if (!view) throw new Error('Mount an editor before revealing table test text');
  const position = view.state.doc.toString().indexOf(text);
  if (position < 0) throw new Error(`Missing test text: ${text}`);
  view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
  view.focus();
}

/** Structural edits replace cell DOM even when the enclosing widget survives. */
export function verifyRetiredTableCellAfterStructuralChange() {
  const content = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content');
  const view = content && EditorView.findFromDOM(content);
  const input = document.activeElement;
  if (!view || !(input instanceof HTMLInputElement) || !input.classList.contains('gn-table-cell-input')) throw new Error('Focus a table cell first');
  const container = input.closest('.gn-table');
  container?.querySelector<HTMLButtonElement>('button[data-operation="addColumn"]')?.click();
  if (input.isConnected) throw new Error('Structural edit did not replace the old cell');
  const expected = view.state.doc;
  input.value = 'retired cell must not overwrite current content';
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  if (view.state.doc !== expected) throw new Error('A retired structural cell changed the document');
}

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
