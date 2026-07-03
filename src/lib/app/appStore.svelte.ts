import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SemanticStatus } from '$lib/types/semantic';
import type { VaultInfo } from '$lib/types/vault';
import {
  loadBootstrapPayload,
  type BootstrapAppResult
} from '$lib/features/notepad/session/bootstrap';
import { logDevError } from '$lib/logDevError';

/**
 * Unified frontend `AppStore`, bootstrapped once at app startup.
 *
 * Holds the cross-cutting backend snapshots (vault info, semantic status,
 * last-known index revision) that previously lived inside
 * each feature store. Subscribes once to the typed event channels emitted
 * by the Rust event bus and exposes Svelte 5 runes so consumers can read
 * with reactivity but without owning their own listener.
 *
 * Existing feature stores still work: this store coexists with them and
 * is additive. Consumers that opt in (Notepad, Settings) read from
 * `appStore` instead of running their own `listen('vault-note-changed', ...)`.
 */

type Listener<T> = (payload: T) => void;

type VaultNoteChangedPayload = {
  notePath: string;
  deleted: boolean;
  source?: string | null;
};

type NoteSavedPayload = {
  noteId: string | null;
  notePath: string | null;
  title: string;
  revision: number;
};

class AppStore {
  vaultInfo = $state<VaultInfo | null>(null);
  semanticStatus = $state<SemanticStatus | null>(null);
  indexRevision = $state<number>(0);
  ready = $state(false);

  // Per-event listener fan-out so feature stores can react without each
  // opening their own Tauri listener. Listeners are registered with
  // `subscribeXxx` and removed via the returned dispose function.
  #vaultNoteChangedListeners = new Set<Listener<VaultNoteChangedPayload>>();
  #semanticStatusListeners = new Set<Listener<SemanticStatus>>();
  #noteSavedListeners = new Set<Listener<NoteSavedPayload>>();
  #vaultChangedListeners = new Set<Listener<VaultInfo>>();

  #unlisteners: UnlistenFn[] = [];
  #bootstrapPromise: Promise<BootstrapAppResult> | null = null;

  /** Boot once. Returns the cached promise on subsequent calls. */
  async bootstrap(): Promise<BootstrapAppResult> {
    if (this.#bootstrapPromise) return this.#bootstrapPromise;
    this.#bootstrapPromise = (async () => {
      const payload = await loadBootstrapPayload();
      this.vaultInfo = payload.vault;
      this.semanticStatus = payload.semanticStatus;
      this.indexRevision = payload.indexRevision ?? 0;
      await this.#attachListeners();
      this.ready = true;
      return payload;
    })();
    return this.#bootstrapPromise;
  }

  /** Tear-down for tests / hot reload. */
  async dispose(): Promise<void> {
    for (const unlisten of this.#unlisteners) {
      try {
        unlisten();
      } catch (error) {
        logDevError('[AppStore] dispose unlisten failed', error);
      }
    }
    this.#unlisteners = [];
    this.#bootstrapPromise = null;
    this.ready = false;
  }

  subscribeVaultNoteChanged(listener: Listener<VaultNoteChangedPayload>): () => void {
    this.#vaultNoteChangedListeners.add(listener);
    return () => this.#vaultNoteChangedListeners.delete(listener);
  }

  subscribeSemanticStatusChanged(listener: Listener<SemanticStatus>): () => void {
    this.#semanticStatusListeners.add(listener);
    return () => this.#semanticStatusListeners.delete(listener);
  }

  subscribeNoteSaved(listener: Listener<NoteSavedPayload>): () => void {
    this.#noteSavedListeners.add(listener);
    return () => this.#noteSavedListeners.delete(listener);
  }

  subscribeVaultChanged(listener: Listener<VaultInfo>): () => void {
    this.#vaultChangedListeners.add(listener);
    return () => this.#vaultChangedListeners.delete(listener);
  }

  setSemanticStatus(status: SemanticStatus | null): void {
    this.semanticStatus = status;
  }

  setVaultInfo(info: VaultInfo | null): void {
    this.vaultInfo = info;
  }

  #dispatchToListeners<T>(channel: string, listeners: Set<Listener<T>>, payload: T): void {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        logDevError(`[AppStore] ${channel} listener failed`, error);
      }
    }
  }

  async #attachListeners(): Promise<void> {
    this.#unlisteners.push(
      await listen<VaultNoteChangedPayload>('vault-note-changed', (event) => {
        this.#dispatchToListeners(
          'vault-note-changed',
          this.#vaultNoteChangedListeners,
          event.payload
        );
      })
    );
    this.#unlisteners.push(
      await listen<SemanticStatus>('semantic-status-changed', (event) => {
        this.semanticStatus = event.payload;
        this.#dispatchToListeners(
          'semantic-status-changed',
          this.#semanticStatusListeners,
          event.payload
        );
      })
    );
    this.#unlisteners.push(
      await listen<NoteSavedPayload>('note-saved', (event) => {
        if (typeof event.payload.revision === 'number') {
          this.indexRevision = event.payload.revision;
        }
        this.#dispatchToListeners('note-saved', this.#noteSavedListeners, event.payload);
      })
    );
    this.#unlisteners.push(
      await listen<VaultInfo>('vault-changed', (event) => {
        this.vaultInfo = event.payload;
        this.#dispatchToListeners('vault-changed', this.#vaultChangedListeners, event.payload);
      })
    );
  }
}

export const appStore = new AppStore();
