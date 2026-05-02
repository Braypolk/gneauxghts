import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SemanticStatus } from '$lib/types/semantic';
import type { VaultInfo } from '$lib/types/vault';
import type { AiSettings } from '$lib/types/ai';
import {
  loadBootstrapPayload,
  type BootstrapAppResult
} from '$lib/features/notepad/session/bootstrap';

/**
 * Break-the-app: one frontend `AppStore`, bootstrapped once.
 *
 * Holds the cross-cutting backend snapshots (vault info, semantic status,
 * AI settings, last-known index revision) that previously lived inside
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
};

type NoteSavedPayload = {
  noteId: string | null;
  notePath: string | null;
  title: string;
  revision: number;
};

type TaskListChangedPayload = {
  noteId: string;
  notePath: string;
  noteTasks: unknown[];
  affectedTaskKey?: string;
  removed: boolean;
};

class AppStore {
  vaultInfo = $state<VaultInfo | null>(null);
  semanticStatus = $state<SemanticStatus | null>(null);
  aiSettings = $state<AiSettings | null>(null);
  indexRevision = $state<number>(0);
  ready = $state(false);

  // Per-event listener fan-out so feature stores can react without each
  // opening their own Tauri listener. Listeners are registered with
  // `subscribeXxx` and removed via the returned dispose function.
  #vaultNoteChangedListeners = new Set<Listener<VaultNoteChangedPayload>>();
  #semanticStatusListeners = new Set<Listener<SemanticStatus>>();
  #inboxChangedListeners = new Set<Listener<void>>();
  #noteSavedListeners = new Set<Listener<NoteSavedPayload>>();
  #taskListChangedListeners = new Set<Listener<TaskListChangedPayload>>();
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
      this.aiSettings = payload.aiSettings;
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
      } catch {
        // best effort
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

  subscribeInboxChanged(listener: Listener<void>): () => void {
    this.#inboxChangedListeners.add(listener);
    return () => this.#inboxChangedListeners.delete(listener);
  }

  subscribeNoteSaved(listener: Listener<NoteSavedPayload>): () => void {
    this.#noteSavedListeners.add(listener);
    return () => this.#noteSavedListeners.delete(listener);
  }

  subscribeTaskListChanged(listener: Listener<TaskListChangedPayload>): () => void {
    this.#taskListChangedListeners.add(listener);
    return () => this.#taskListChangedListeners.delete(listener);
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

  setAiSettings(settings: AiSettings | null): void {
    this.aiSettings = settings;
  }

  async #attachListeners(): Promise<void> {
    this.#unlisteners.push(
      await listen<VaultNoteChangedPayload>('vault-note-changed', (event) => {
        for (const listener of this.#vaultNoteChangedListeners) {
          try {
            listener(event.payload);
          } catch {
            // continue dispatching to other listeners
          }
        }
      })
    );
    this.#unlisteners.push(
      await listen<SemanticStatus>('semantic-status-changed', (event) => {
        this.semanticStatus = event.payload;
        for (const listener of this.#semanticStatusListeners) {
          try {
            listener(event.payload);
          } catch {
            // continue dispatching
          }
        }
      })
    );
    this.#unlisteners.push(
      await listen('inbox-changed', () => {
        for (const listener of this.#inboxChangedListeners) {
          try {
            listener();
          } catch {
            // continue dispatching
          }
        }
      })
    );
    this.#unlisteners.push(
      await listen<NoteSavedPayload>('note-saved', (event) => {
        if (typeof event.payload.revision === 'number') {
          this.indexRevision = event.payload.revision;
        }
        for (const listener of this.#noteSavedListeners) {
          try {
            listener(event.payload);
          } catch {
            // continue dispatching
          }
        }
      })
    );
    this.#unlisteners.push(
      await listen<TaskListChangedPayload>('task-list-changed', (event) => {
        for (const listener of this.#taskListChangedListeners) {
          try {
            listener(event.payload);
          } catch {
            // continue dispatching
          }
        }
      })
    );
    this.#unlisteners.push(
      await listen<VaultInfo>('vault-changed', (event) => {
        this.vaultInfo = event.payload;
        for (const listener of this.#vaultChangedListeners) {
          try {
            listener(event.payload);
          } catch {
            // continue dispatching
          }
        }
      })
    );
  }
}

export const appStore = new AppStore();
