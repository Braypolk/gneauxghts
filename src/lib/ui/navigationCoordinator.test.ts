import { describe, expect, it, vi } from 'vitest';
import { createNavigationCoordinator } from './navigationCoordinator';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const normalize = (pathname: string) => pathname === '/index.html' ? '/' : pathname;

describe('createNavigationCoordinator', () => {
  it('drops a stale destination when a newer click arrives during a save', async () => {
    let currentPath = '/';
    const pendingSave = deferred();
    const navigate = vi.fn(async (href: string) => { currentPath = href; });
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
    const navigate = vi.fn(async (href: string) => { currentPath = href; });
    const coordinator = createNavigationCoordinator({
      getCurrentPathname: () => currentPath,
      normalizePathname: normalize,
      flushPendingWork: async () => { throw new Error('save failed'); },
      navigate,
      onFlushError
    });

    await coordinator.request('/atlas');

    expect(onFlushError).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/atlas');
  });
});
