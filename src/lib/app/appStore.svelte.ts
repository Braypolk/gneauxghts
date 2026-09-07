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
  documentKind?: 'note' | 'chatIndex' | 'chatTranscript';
  source?: string | null;
  chatId?: string | null;
};

type NoteSavedPayload = {
  noteId: string | null;
  notePath: string | null;
  title: string;
  revision: number;
};

export class AppStore {
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
  #generation = 0;
  #snapshotRevisions = { vault: 0, semanticStatus: 0, indexRevision: 0 };
  #bootstrapPromise: Promise<BootstrapAppResult> | null = null;

  /** Boot once. Returns the cached promise on subsequent calls. */
  async bootstrap(): Promise<BootstrapAppResult> {
    if (this.#bootstrapPromise) return this.#bootstrapPromise;
    const generation = this.#generation;
    const revisions = { ...this.#snapshotRevisions };
    this.#bootstrapPromise = (async () => {
      // Establish event admission while the backend restores canonical Markdown.
      // Editable session application still waits for both, so the first save
      // cannot outrun its note-saved listener.
      const [bootstrap, listeners] = await Promise.allSettled([
        loadBootstrapPayload(),
        this.#attachListeners(generation)
      ]);
      if (bootstrap.status === 'rejected') throw bootstrap.reason;
      if (listeners.status === 'rejected') throw listeners.reason;
      const payload = bootstrap.value;
      if (generation !== this.#generation) return payload;
      if (revisions.vault === this.#snapshotRevisions.vault) this.vaultInfo = payload.vault;
      if (revisions.semanticStatus === this.#snapshotRevisions.semanticStatus) this.semanticStatus = payload.semanticStatus;
      if (revisions.indexRevision === this.#snapshotRevisions.indexRevision) this.indexRevision = payload.indexRevision ?? 0;
      this.ready = true;
      return payload;
    })();
    return this.#bootstrapPromise;
  }

  /** Tear-down for tests / hot reload. */
  async dispose(): Promise<void> {
    this.#generation += 1;
    this.#detachListeners();
    this.#bootstrapPromise = null;
    this.ready = false;
  }

  #detachListeners() {
    for (const unlisten of this.#unlisteners) {
      try {
        unlisten();
      } catch (error) {
        logDevError('[AppStore] dispose unlisten failed', error);
      }
    }
    this.#unlisteners = [];
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
    this.#snapshotRevisions.semanticStatus += 1;
    this.semanticStatus = status;
  }

  setVaultInfo(info: VaultInfo | null): void {
    this.#snapshotRevisions.vault += 1;
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

  async #attachListeners(generation: number): Promise<void> {
    const attach = async <T>(channel: string, callback: (payload: T) => void) => {
      const unlisten = await listen<T>(channel, (event) => {
        if (generation === this.#generation) callback(event.payload);
      });
      if (generation === this.#generation) this.#unlisteners.push(unlisten);
      else unlisten();
    };
    const results = await Promise.allSettled([
      attach<VaultNoteChangedPayload>('vault-note-changed', (payload) => {
        this.#dispatchToListeners('vault-note-changed', this.#vaultNoteChangedListeners, payload);
      }),
      attach<SemanticStatus>('semantic-status-changed', (payload) => {
        this.#snapshotRevisions.semanticStatus += 1;
        this.semanticStatus = payload;
        this.#dispatchToListeners('semantic-status-changed', this.#semanticStatusListeners, payload);
      }),
      attach<NoteSavedPayload>('note-saved', (payload) => {
        this.#snapshotRevisions.indexRevision += 1;
        if (typeof payload.revision === 'number') this.indexRevision = payload.revision;
        this.#dispatchToListeners('note-saved', this.#noteSavedListeners, payload);
      }),
      attach<VaultInfo>('vault-changed', (payload) => {
        this.#snapshotRevisions.vault += 1;
        this.vaultInfo = payload;
        this.#dispatchToListeners('vault-changed', this.#vaultChangedListeners, payload);
      })
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logDevError('[AppStore] listener setup failed', result.reason);
      }
    }
  }
}

export const appStore = new AppStore();
