import type { ChatContextSuggestionResponse } from '../types';

/** Debounce typing and keep one running search plus only the latest pending query. */
export function createContextSuggestionSearch(deps: {
  apply: (response: ChatContextSuggestionResponse | null) => void;
  setLoading: (loading: boolean) => void;
  delayMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => Promise<ChatContextSuggestionResponse>) | null = null;
  let running = false;
  let ready = false;
  let revision = 0;
  let disposed = false;

  function cancelPending() {
    revision += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
    ready = false;
  }

  async function run() {
    if (disposed || running || !ready || !pending) return;
    const request = pending;
    const token = revision;
    pending = null;
    ready = false;
    running = true;
    try {
      const response = await request();
      if (!disposed && token === revision) deps.apply(response);
    } catch {
      if (!disposed && token === revision) deps.apply(null);
    } finally {
      running = false;
      if (!disposed && token === revision) deps.setLoading(false);
      void run();
    }
  }

  return {
    schedule(request: () => Promise<ChatContextSuggestionResponse>) {
      if (disposed) return;
      cancelPending();
      pending = request;
      deps.setLoading(true);
      timer = setTimeout(() => {
        timer = null;
        ready = true;
        void run();
      }, deps.delayMs ?? 350);
    },
    clear() {
      cancelPending();
      if (!disposed) {
        deps.apply(null);
        deps.setLoading(false);
      }
    },
    dispose() {
      disposed = true;
      cancelPending();
    }
  };
}
