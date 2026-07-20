export interface NavigationCoordinatorDependencies {
  getCurrentPathname: () => string;
  normalizePathname: (pathname: string) => string;
  flushPendingWork: () => Promise<void>;
  navigate: (href: string) => Promise<void>;
  onFlushError?: (error: unknown) => void;
  /** Called when goto would no-op because the URL already matches the target. */
  onForceRemount?: () => void;
}

/**
 * Serializes app-shell navigation and always honors the newest destination.
 * Dedupes against the last completed navigation (`settledPathname`), not live
 * `page.url` — hover-preload can advance the URL without swapping the view.
 */
export function createNavigationCoordinator(dependencies: NavigationCoordinatorDependencies) {
  let requestedHref: string | null = null;
  let drainPromise: Promise<void> | null = null;
  let settledPathname = dependencies.normalizePathname(dependencies.getCurrentPathname());

  async function drain() {
    while (requestedHref) {
      const href = requestedHref;
      requestedHref = null;
      const target = dependencies.normalizePathname(href);

      if (settledPathname === target) {
        continue;
      }

      try {
        await dependencies.flushPendingWork();
      } catch (error) {
        dependencies.onFlushError?.(error);
      }

      // A newer click arrived while pending editor work was flushing. Skip
      // this stale route and let the next loop iteration handle the new one.
      if (requestedHref) continue;

      if (settledPathname === target) {
        continue;
      }

      const pathBeforeNavigate = dependencies.normalizePathname(dependencies.getCurrentPathname());
      await dependencies.navigate(href);
      settledPathname = target;

      // If the URL already matched before goto (e.g. preload updated page.url
      // without mounting the page), SvelteKit no-ops — force a shell remount.
      if (pathBeforeNavigate === target) {
        dependencies.onForceRemount?.();
      }
    }
  }

  function request(href: string) {
    requestedHref = href;
    if (!drainPromise) {
      drainPromise = drain().finally(() => {
        drainPromise = null;
        if (requestedHref) void request(requestedHref);
      });
    }
    return drainPromise;
  }

  return { request };
}
