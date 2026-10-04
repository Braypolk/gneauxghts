import { describe, expect, it, vi } from 'vitest';
import { cutCurrentBlock } from './editorShortcuts';
import { createCommandView } from './commandTestSupport';
import { history, undo } from '@codemirror/commands';

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
