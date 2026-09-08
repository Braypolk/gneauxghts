import { startupMark, observeStartupReadiness } from '$lib/e2e/startupMetrics';
import { invoke } from '@tauri-apps/api/core';
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
 * Notepad and Settings consume these admitted snapshots rather than retaining
 * another copy or attaching equivalent event listeners.
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

export type AppSnapshotAdmission = Readonly<{
  generation: number;
  vault: number | null;
  semanticStatus: number | null;
  indexRevision: number | null;
}>;

type AppSnapshotSlice = keyof Omit<AppSnapshotAdmission, 'generation'>;

type AppSnapshot = {
  vault?: VaultInfo;
  semanticStatus?: SemanticStatus | null;
  indexRevision?: number;
};

type ListenerAdmission = {
  unlisteners: UnlistenFn[];
  admit: () => void;
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

  /** Boot once after success. A failed payload or listener admission can retry. */
  async bootstrap(): Promise<BootstrapAppResult> {
    if (this.#bootstrapPromise) return this.#bootstrapPromise;
    const generation = this.#generation;
    const admission = this.beginSnapshotAdmission(
      'vault',
      'semanticStatus',
      'indexRevision'
    );
    let attemptListeners: UnlistenFn[] = [];
    const attempt = (async () => {
      // Establish event admission while the backend restores canonical Markdown.
      // Editable session application still waits for both, so the first save
      // cannot outrun its note-saved listener.
      const [bootstrap, listeners] = await Promise.allSettled([
        loadBootstrapPayload().then(payload => {
          startupMark('canonical-bootstrap-payload', { noteId: payload.session.currentNoteId });
          observeStartupReadiness(payload.session.currentNoteId);
          return payload;
        }),
        this.#createListeners(generation).then((listenerAdmission) => {
          attemptListeners = listenerAdmission.unlisteners;
          return listenerAdmission;
        })
      ]);
      if (bootstrap.status === 'rejected') {
        for (const unlisten of attemptListeners) unlisten();
        throw bootstrap.reason;
      }
      if (listeners.status === 'rejected') throw listeners.reason;
      const payload = bootstrap.value;
      if (generation !== this.#generation) return payload;
      this.#unlisteners.push(...listeners.value.unlisteners);
      listeners.value.admit();
      startupMark('bootstrap-listeners-admitted');
      this.admitSnapshot(
        {
          vault: payload.vault,
          semanticStatus: payload.semanticStatus,
          indexRevision: payload.indexRevision ?? 0
        },
        admission
      );
      this.ready = true;
      startupMark('bootstrap-session-admitted');
      return payload;
    })();
    this.#bootstrapPromise = attempt;
    try {
      return await attempt;
    } catch (error) {
      if (this.#bootstrapPromise === attempt) this.#bootstrapPromise = null;
      if (generation === this.#generation) this.ready = false;
      throw error;
    }
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

  beginSnapshotAdmission(...slices: AppSnapshotSlice[]): AppSnapshotAdmission {
    const claimed = new Set(slices);
    for (const slice of claimed) this.#snapshotRevisions[slice] += 1;
    return {
      generation: this.#generation,
      vault: claimed.has('vault') ? this.#snapshotRevisions.vault : null,
      semanticStatus: claimed.has('semanticStatus')
        ? this.#snapshotRevisions.semanticStatus
        : null,
      indexRevision: claimed.has('indexRevision')
        ? this.#snapshotRevisions.indexRevision
        : null
    };
  }

  admitSnapshot(snapshot: AppSnapshot, admission: AppSnapshotAdmission) {
    const admitted = { vault: false, semanticStatus: false, indexRevision: false };
    if (admission.generation !== this.#generation) return admitted;
    if (
      'vault' in snapshot &&
      admission.vault !== null &&
      admission.vault === this.#snapshotRevisions.vault
    ) {
      this.#snapshotRevisions.vault += 1;
      this.vaultInfo = snapshot.vault ?? null;
      admitted.vault = true;
    }
    if (
      'semanticStatus' in snapshot &&
      admission.semanticStatus !== null &&
      admission.semanticStatus === this.#snapshotRevisions.semanticStatus
    ) {
      this.#snapshotRevisions.semanticStatus += 1;
      this.semanticStatus = snapshot.semanticStatus ?? null;
      admitted.semanticStatus = true;
    }
    if (
      'indexRevision' in snapshot &&
      admission.indexRevision !== null &&
      admission.indexRevision === this.#snapshotRevisions.indexRevision
    ) {
      this.#snapshotRevisions.indexRevision += 1;
      this.indexRevision = snapshot.indexRevision ?? 0;
      admitted.indexRevision = true;
    }
    return admitted;
  }

  async refreshVaultInfo(): Promise<void> {
    const admission = this.beginSnapshotAdmission('vault');
    const vault = await invoke<VaultInfo>('get_vault_info');
    this.admitSnapshot({ vault }, admission);
  }

  async refreshSemanticStatus(): Promise<void> {
    const admission = this.beginSnapshotAdmission('semanticStatus');
    const semanticStatus = await invoke<SemanticStatus>('get_semantic_status');
    this.admitSnapshot({ semanticStatus }, admission);
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

  async #createListeners(generation: number): Promise<ListenerAdmission> {
    let admitted = false;
    const pendingEvents: Array<() => void> = [];
    const attach = async <T>(channel: string, callback: (payload: T) => void) => {
      const unlisten = await listen<T>(channel, (event) => {
        if (generation !== this.#generation) return;
        if (admitted) callback(event.payload);
        else pendingEvents.push(() => callback(event.payload));
      });
      if (generation !== this.#generation) unlisten();
      return unlisten;
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
    const attached = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      for (const unlisten of attached) unlisten();
      throw failure.reason;
    }
    if (generation !== this.#generation) return { unlisteners: [], admit: () => undefined };
    return {
      unlisteners: attached,
      admit: () => {
        admitted = true;
        for (const applyEvent of pendingEvents.splice(0)) applyEvent();
      }
    };
  }
}

export const appStore = new AppStore();
