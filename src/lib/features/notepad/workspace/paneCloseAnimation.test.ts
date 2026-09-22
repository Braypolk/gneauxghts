import { describe, expect, it, vi } from 'vitest';
import { createPaneCloseAnimation } from './paneCloseAnimation';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('pane close presentation', () => {
  it('waits for rendered motion completion instead of a fixed delay', async () => {
    const rendered = deferred();
    const motion = deferred();
    const deps = {
      beginCollapse: vi.fn(), endCollapse: vi.fn(),
      settle: () => rendered.promise,
      waitForMotion: vi.fn(() => motion.promise),
      prefersReducedMotion: () => false
    };
    const animation = createPaneCloseAnimation(deps);
    let complete = false;
    const closing = animation.collapse('right').then(() => { complete = true; });
    expect(deps.beginCollapse).toHaveBeenCalledWith('right');
    expect(deps.waitForMotion).not.toHaveBeenCalled();
    rendered.resolve();
    await Promise.resolve();
    expect(deps.waitForMotion).toHaveBeenCalledOnce();
    expect(complete).toBe(false);
    motion.resolve();
    await closing;
    expect(complete).toBe(true);
    animation.release('right');
    expect(deps.endCollapse).toHaveBeenCalledWith('right');
  });

  it('does not delay reduced-motion closes', async () => {
    const deps = {
      beginCollapse: vi.fn(), endCollapse: vi.fn(), settle: vi.fn(),
      waitForMotion: vi.fn(), prefersReducedMotion: () => true
    };
    await createPaneCloseAnimation(deps).collapse('left');
    expect(deps.beginCollapse).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.waitForMotion).not.toHaveBeenCalled();
  });
});
