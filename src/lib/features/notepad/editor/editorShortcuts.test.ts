import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFilteredDefaultKeymap, createMarkdownBaseExtensions, cutCurrentBlock } from './editorShortcuts';
import { createCommandView } from './commandTestSupport';
import { history, undo, splitLine, deleteToLineEnd, transposeChars } from '@codemirror/commands';
import { keymap, runScopeHandlers } from '@codemirror/view';
import { resetAllKeyboardShortcuts, setKeyboardShortcutBindings } from '#lib/keyboardShortcuts.svelte.js';

describe('registered editor commands', () => {
  afterEach(resetAllKeyboardShortcuts);

  it('runs a reassigned command before the base Enter binding', () => {
    const { view } = createCommandView({ doc: 'one', selection: { anchor: 1 }, extensions: [createMarkdownBaseExtensions(), createFilteredDefaultKeymap()] });
    setKeyboardShortcutBindings('editorCopyLineDown', ['Enter']);
    expect(runScopeHandlers(view, { key: 'Enter', code: 'Enter' } as KeyboardEvent, 'editor')).toBe(true);
    expect(view.state.doc.toString()).toBe('one\none');
  });

  it('runs an additional binding and stops using a removed binding without recreating the editor', () => {
    const { view } = createCommandView({ doc: 'one\ntwo', selection: { anchor: 1 }, extensions: [createFilteredDefaultKeymap()] });
    const run = view.state.facet(keymap).flat().find(binding => binding.any)!.any!;
    setKeyboardShortcutBindings('editorCopyLineDown', ['Ctrl+d', 'Ctrl+e']);
    expect(run(view, { key: 'e', code: 'KeyE', ctrlKey: true } as KeyboardEvent)).toBe(true);
    expect(view.state.doc.toString()).toBe('one\none\ntwo');
    setKeyboardShortcutBindings('editorCopyLineDown', []);
    expect(run(view, { key: 'e', code: 'KeyE', ctrlKey: true } as KeyboardEvent)).toBe(false);
    expect(run(view, { key: 'ArrowDown', code: 'ArrowDown', altKey: true, shiftKey: true } as KeyboardEvent)).toBe(false);
    expect(view.state.doc.toString()).toBe('one\none\ntwo');
  });

  it('remaps split line and keeps removed editing commands out of the inherited keymap', () => {
    const { view } = createCommandView({ doc: 'one', selection: { anchor: 1 }, extensions: [createFilteredDefaultKeymap()] });
    const bindings = view.state.facet(keymap).flat();
    const run = bindings.find(binding => binding.any)!.any!;
    setKeyboardShortcutBindings('editorSplitLine', ['Ctrl+q']);
    expect(run(view, { key: 'o', ctrlKey: true } as KeyboardEvent)).toBe(false);
    expect(run(view, { key: 'q', ctrlKey: true } as KeyboardEvent)).toBe(true);
    expect(view.state.doc.toString()).toBe('o\nne');
    expect(view.state.selection.main.head).toBe(1);
    setKeyboardShortcutBindings('editorSplitLine', []);
    expect(run(view, { key: 'q', ctrlKey: true } as KeyboardEvent)).toBe(false);
    expect(bindings.some(binding => [splitLine, deleteToLineEnd, transposeChars].includes(binding.run!))).toBe(false);
  });

  it('uses the assigned structural indent and outdent keys without rebuilding the editor', () => {
    const doc = '- parent\n- child';
    const { view } = createCommandView({ doc, selection: { anchor: doc.indexOf('child') }, extensions: createMarkdownBaseExtensions() });
    const run = view.state.facet(keymap).flat().find(binding => binding.any)!.any!;
    setKeyboardShortcutBindings('editorStructuralIndent', ['Ctrl+q']);
    setKeyboardShortcutBindings('editorStructuralOutdent', ['Ctrl+Shift+q']);
    expect(run(view, { key: 'Tab' } as KeyboardEvent)).toBe(false);
    expect(run(view, { key: 'q', ctrlKey: true } as KeyboardEvent)).toBe(true);
    expect(view.state.doc.toString()).toBe('- parent\n  - child');
    expect(run(view, { key: 'Q', ctrlKey: true, shiftKey: true } as KeyboardEvent)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe('asynchronous block cut', () => {
  for (const change of ['unchanged', 'selection', 'typing', 'owner', 'destroyed', 'rejected']) {
    it(`handles ${change} while clipboard is pending`, async () => {
      const { view } = createCommandView({ doc: 'one\ntwo', selection: { anchor: 1 }, extensions: [history()] });
      let resolve!: () => void; let reject!: (error: Error) => void;
      const clipboard = vi.fn(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
      let current = true;
      const pending = cutCurrentBlock(view, () => current, clipboard);
      if (change === 'selection') view.dispatch({ selection: { anchor: 5 } });
      if (change === 'typing') view.dispatch({ changes: { from: 0, insert: 'x' } });
      if (change === 'owner') current = false;
      if (change === 'destroyed') Object.assign(view.dom, { isConnected: false });
      const before = view.state.doc.toString();
      if (change === 'rejected') { reject(new Error('denied')); await expect(pending).rejects.toThrow('denied'); }
      else { resolve(); expect(await pending).toBe(change === 'unchanged'); }
      expect(clipboard).toHaveBeenCalledOnce();
      if (change !== 'unchanged') expect(view.state.doc.toString()).toBe(before);
      else {
        expect(view.state.doc.toString()).toBe('two');
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(before);
        expect(view.state.selection.main.head).toBe(1);
      }
    });
  }
});
