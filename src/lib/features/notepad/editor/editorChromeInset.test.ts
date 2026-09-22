import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorChromeInset } from './editorChromeInset';

afterEach(() => vi.unstubAllGlobals());

describe('editor chrome resize updates', () => {
  it('coalesces notifications and writes only a changed vertical inset', () => {
    let callback!: () => void;
    let frame: FrameRequestCallback | null = null;
    let bottom = 164;
    const overlay = { getBoundingClientRect: () => ({ bottom }) };
    const shell = {
      closest: () => ({ querySelector: () => overlay }),
      getBoundingClientRect: () => ({ top: 100 }),
      style: { setProperty: vi.fn(), removeProperty: vi.fn() }
    };
    const cancel = vi.fn(() => { frame = null; });
    const disconnect = vi.fn();
    vi.stubGlobal('document', { querySelector: () => null });
    vi.stubGlobal('window', {
      requestAnimationFrame: (next: FrameRequestCallback) => { frame = next; return 1; },
      cancelAnimationFrame: cancel,
      addEventListener: vi.fn(), removeEventListener: vi.fn()
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(next: () => void) { callback = next; }
      observe() {}
      disconnect = disconnect;
    });
    const paint = () => { const next = frame; frame = null; next?.(0); };
    const action = editorChromeInset(shell as unknown as HTMLElement);
    paint();
    for (let i = 0; i < 10; i++) { callback(); paint(); }
    expect(shell.style.setProperty).toHaveBeenCalledExactlyOnceWith('--editor-overlay-inset', '64px');
    bottom = 180;
    callback(); callback(); paint();
    expect(shell.style.setProperty).toHaveBeenLastCalledWith('--editor-overlay-inset', '80px');
    expect(shell.style.setProperty).toHaveBeenCalledTimes(2);
    callback();
    action.destroy();
    expect(cancel).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
