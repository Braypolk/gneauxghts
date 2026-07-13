export interface NavigationCoordinatorDependencies {
  getCurrentPathname: () => string;
  normalizePathname: (pathname: string) => string;
  flushPendingWork: () => Promise<void>;
  navigate: (href: string) => Promise<void>;
  onFlushError?: (error: unknown) => void;
}

/**
 * Serializes app-shell navigation and always honors the newest destination.
 * This prevents a slow editor save or route transition from completing after
 * a newer navbar click and leaving the selected route out of sync with the
 * mounted workspace.
 */
export function createNavigationCoordinator(dependencies: NavigationCoordinatorDependencies) {
  let requestedHref: string | null = null;
  let drainPromise: Promise<void> | null = null;

  async function drain() {
    while (requestedHref) {
      const href = requestedHref;
      requestedHref = null;
      const target = dependencies.normalizePathname(href);

      if (dependencies.normalizePathname(dependencies.getCurrentPathname()) === target) {
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

      if (dependencies.normalizePathname(dependencies.getCurrentPathname()) !== target) {
        await dependencies.navigate(href);
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
