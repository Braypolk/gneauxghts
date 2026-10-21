import { listen } from '@tauri-apps/api/event';
import { isTauriRuntime } from '#lib/tauriRuntime.js';
import { logDevError } from '#lib/logDevError.js';
import { ListenerScope } from './listenerScope';

type BackgroundSave = () => Promise<void>;
const handlers = new Set<BackgroundSave>();

/** Subscriptions only: feature owners retain their existing state and queues. */
export function registerBackgroundSave(handler: BackgroundSave) {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

export function installBackgroundPersistence() {
  const scope = new ListenerScope();
  let disposed = false;
  const flush = () => {
    if (disposed) return;
    for (const handler of [...handlers]) {
      try {
        void handler().catch(error => logDevError('Background save failed; edits remain unsaved', error));
      } catch (error) {
        logDevError('Background save failed; edits remain unsaved', error);
      }
    }
  };
  const visibilityChanged = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('pagehide', flush);
  if (isTauriRuntime()) {
    void scope.acquire(() => listen('app://backgrounding', flush)).catch(error => {
      logDevError('Native background-save listener unavailable', error);
    });
  }
  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('pagehide', flush);
    scope.close();
  };
}
