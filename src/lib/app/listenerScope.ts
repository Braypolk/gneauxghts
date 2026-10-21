import { logDevError } from '#lib/logDevError.js';

/** Own subscriptions as they arrive, including those acquired after retirement. */
export class ListenerScope {
  #closed = false;
  #unlisteners = [] as (() => void)[];

  get closed() { return this.#closed; }

  async acquire(attach: () => Promise<() => void>) {
    try {
      const unlisten = await attach();
      if (this.#closed) this.#release(unlisten);
      else this.#unlisteners.push(unlisten);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close() {
    this.#closed = true;
    for (const unlisten of this.#unlisteners) this.#release(unlisten);
    this.#unlisteners = [];
  }

  #release(unlisten: () => void) {
    try { unlisten(); }
    catch (error) { logDevError('Listener cleanup failed', error); }
  }
}
