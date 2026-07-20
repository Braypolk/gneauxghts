import { describe, expect, it, vi } from 'vitest';
import { createNavigationCoordinator } from './navigationCoordinator';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const normalize = (pathname: string) => (pathname === '/index.html' ? '/' : pathname);

describe('createNavigationCoordinator', () => {
  it('drops a stale destination when a newer click arrives during a save', async () => {
    let currentPath = '/';
    const pendingSave = deferred();
    const navigate = vi.fn(async (href: string) => {
      currentPath = href;
    });
    const coordinator = createNavigationCoordinator({
      getCurrentPathname: () => currentPath,
      normalizePathname: normalize,
      flushPendingWork: () => pendingSave.promise,
      navigate
    });

    const atlasRequest = coordinator.request('/atlas');
    await Promise.resolve();
    const editorRequest = coordinator.request('/');
    pendingSave.resolve();
    await Promise.all([atlasRequest, editorRequest]);

    expect(navigate).not.toHaveBeenCalled();
    expect(currentPath).toBe('/');
  });

  it('navigates to the newest destination after an earlier route settles', async () => {
    let currentPath = '/';
    const firstNavigation = deferred();
    const navigate = vi.fn(async (href: string) => {
      if (href === '/atlas') await firstNavigation.promise;
      currentPath = href;
    });
    const coordinator = createNavigationCoordinator({
      getCurrentPathname: () => currentPath,
      normalizePathname: normalize,
      flushPendingWork: async () => undefined,
      navigate
    });

    const atlasRequest = coordinator.request('/atlas');
    await Promise.resolve();
    const editorRequest = coordinator.request('/');
    firstNavigation.resolve();
    await Promise.all([atlasRequest, editorRequest]);

    expect(navigate.mock.calls).toEqual([['/atlas'], ['/']]);
    expect(currentPath).toBe('/');
  });

  it('continues navigation when flushing pending work fails', async () => {
    let currentPath = '/';
    const onFlushError = vi.fn();
    const navigate = vi.fn(async (href: string) => {
      currentPath = href;
    });
    const coordinator = createNavigationCoordinator({
      getCurrentPathname: () => currentPath,
      normalizePathname: normalize,
      flushPendingWork: async () => {
        throw new Error('save failed');
      },
      navigate,
      onFlushError
    });

    await coordinator.request('/atlas');

    expect(onFlushError).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/atlas');
  });

  it('force-remounts when page.url already matches the target before goto', async () => {
    // Simulates hover-preload advancing page.url without swapping the view.
    let currentPath = '/';
    const navigate = vi.fn(async () => {
      /* SvelteKit no-op when URL already matches */
    });
    const onForceRemount = vi.fn();
    const coordinator = createNavigationCoordinator({
      getCurrentPathname: () => currentPath,
      normalizePathname: normalize,
      flushPendingWork: async () => undefined,
      navigate,
      onForceRemount
    });

    // Coordinator believes we are still on atlas (settled from construction
    // would be `/` here — seed by navigating away first).
    currentPath = '/atlas';
    await coordinator.request('/atlas');
    onForceRemount.mockClear();
    navigate.mockClear();

    // Preload already flipped the live URL to notes while atlas is still up.
    currentPath = '/';
    await coordinator.request('/');

    expect(navigate).toHaveBeenCalledWith('/');
    expect(onForceRemount).toHaveBeenCalledOnce();
  });

  it('does not navigate again when already settled on the destination', async () => {
    let currentPath = '/atlas';
    const navigate = vi.fn(async (href: string) => {
      currentPath = href;
    });
    const coordinator = createNavigationCoordinator({
      getCurrentPathname: () => currentPath,
      normalizePathname: normalize,
      flushPendingWork: async () => undefined,
      navigate
    });

    await coordinator.request('/atlas');
    expect(navigate).not.toHaveBeenCalled();
  });
});
