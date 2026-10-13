import { afterEach, describe, expect, it, vi } from 'vitest';
import { mobileViewport } from './mobileViewport';

function surface() {
  const values = new Map<string, string>();
  return { dataset: {} as Record<string, string>, style: {
    setProperty: (key: string, value: string) => values.set(key, value),
    removeProperty: (key: string) => values.delete(key),
    getPropertyValue: (key: string) => values.get(key) ?? ''
  } };
}

function fixture(height = 402, touch = true) {
  const viewport = Object.assign(new EventTarget(), { width: 874, height, offsetTop: 0, scale: 1 });
  const root = surface();
  let callback: FrameRequestCallback | undefined;
  const win = Object.assign(new EventTarget(), {
    innerWidth: 874, innerHeight: 402, visualViewport: viewport,
    matchMedia: () => Object.assign(new EventTarget(), { matches: touch }),
    requestAnimationFrame: (next: FrameRequestCallback) => { callback = next; return 1; },
    cancelAnimationFrame: vi.fn()
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { documentElement: root });
  const node = surface();
  const action = mobileViewport(node as unknown as HTMLElement);
  const flush = () => { const next = callback; callback = undefined; next?.(0); };
  flush();
  return { node, win, viewport, action, flush };
}

afterEach(() => vi.unstubAllGlobals());

describe('mobile viewport', () => {
  it('fits the visible keyboard viewport once and recovers after dismissal', () => {
    const { node, viewport, flush } = fixture();
    viewport.height = 126;
    viewport.dispatchEvent(new Event('resize')); flush();
    expect(node.style.getPropertyValue('--app-shell-height')).toBe('126px');
    expect(node.style.getPropertyValue('--keyboard-inset-height')).toBe('0px');
    expect(node.dataset.keyboardOpen).toBe('true');
    viewport.height = 402;
    viewport.dispatchEvent(new Event('resize')); flush();
    expect(node.style.getPropertyValue('--app-shell-height')).toBe('402px');
    expect(node.dataset.keyboardOpen).toBe('false');
  });

  it('recognizes a keyboard already open at mount and across rotation', () => {
    const { node, viewport, win, flush } = fixture(126);
    expect(node.dataset.keyboardOpen).toBe('true');
    win.innerWidth = 402; win.innerHeight = 874;
    viewport.width = 402; viewport.height = 500;
    win.dispatchEvent(new Event('orientationchange')); flush();
    expect(node.style.getPropertyValue('--app-shell-height')).toBe('500px');
    expect(node.dataset.keyboardOpen).toBe('true');
  });

  it('leaves the desktop shell sizing to CSS', () => {
    const { node } = fixture(126, false);
    expect(node.style.getPropertyValue('--app-shell-height')).toBe('');
    expect(node.dataset.keyboardOpen).toBe('false');
  });

  it('tracks viewport panning and removes its measurements on teardown', () => {
    const { node, viewport, action, flush } = fixture();
    viewport.height = 180; viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event('scroll')); flush();
    expect(node.style.getPropertyValue('--app-viewport-top')).toBe('40px');
    action.destroy();
    viewport.dispatchEvent(new Event('resize')); flush();
    expect(node.style.getPropertyValue('--app-shell-height')).toBe('');
    expect(node.dataset.keyboardOpen).toBeUndefined();
  });
});
