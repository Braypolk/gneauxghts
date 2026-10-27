import { startupMark, observeStartupReadiness } from '#lib/e2e/startupMetrics.js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ListenerScope } from './listenerScope';
import type { SemanticDebugSnapshot, SemanticSettings, SemanticStatus } from '#lib/types/semantic.js';
import type { VaultInfo, WatcherHealth } from '#lib/types/vault.js';
import {
  loadBootstrapPayload,
  type BootstrapAppResult
} from '#lib/features/notepad/session/bootstrap.js';
import { logDevError } from '#lib/logDevError.js';

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
  documentKind?: 'note';
  source?: string | null;
};

type NoteSavedPayload = {
  noteId: string | null;
  notePath: string | null;
  title: string;
  revision: number;
};

type AppSnapshotAdmission = Readonly<{
  generation: number;
  vault: number | null;
  semanticStatus: number | null;
  indexRevision: number | null;
}>;

type AppSnapshotSlice = keyof Omit<AppSnapshotAdmission, 'generation'>;

type AppSnapshot = {
  vault?: VaultInfo;
  watcherHealth?: WatcherHealth;
  semanticStatus?: SemanticStatus | null;
  indexRevision?: number;
};

export interface SettingsViewPayload {
  vault: VaultInfo;
  watcherHealth: WatcherHealth;
  semanticStatus: SemanticStatus;
  semanticSettings: SemanticSettings;
  semanticDebug: SemanticDebugSnapshot;
}

export class AppStore {
  vaultInfo = $state<VaultInfo | null>(null);
  watcherHealth = $state<WatcherHealth | null>(null);
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

  #listenerScope: ListenerScope | null = null;
  #generation = 0;
  #snapshotRevisions = { vault: 0, semanticStatus: 0, indexRevision: 0 };
  #bootstrapPromise: Promise<BootstrapAppResult> | null = null;

  /** Boot once after success. A failed payload or listener admission can retry. */
  async bootstrap(): Promise<BootstrapAppResult> {
    if (this.#bootstrapPromise) return this.#bootstrapPromise;
    const generation = this.#generation;
    const admission = this.#beginSnapshotAdmission(
      'vault',
      'semanticStatus',
      'indexRevision'
    );
    const scope = new ListenerScope();
    this.#listenerScope = scope;
    const attempt = (async () => {
      // Attach before fetching: an early startup failure must be present in
      // either the retained snapshot or the event queue, with no listener gap.
      const listeners = await this.#createListeners(generation, scope);
      if (generation !== this.#generation || scope.closed) {
        throw new Error('Application bootstrap was disposed');
      }
      const payload = await loadBootstrapPayload();
      startupMark('canonical-bootstrap-payload', { noteId: payload.session.currentNoteId });
      observeStartupReadiness(payload.session.currentNoteId);
      if (generation !== this.#generation) return payload;
      listeners();
      startupMark('bootstrap-listeners-admitted');
      this.#admitSnapshot(
        {
          vault: payload.vault,
          watcherHealth: payload.watcherHealth,
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
      scope.close();
      if (this.#listenerScope === scope) this.#listenerScope = null;
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
    this.watcherHealth = null;
  }

  #detachListeners() {
    this.#listenerScope?.close();
    this.#listenerScope = null;
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

  #beginSnapshotAdmission(...slices: AppSnapshotSlice[]): AppSnapshotAdmission {
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

  #admitSnapshot(snapshot: AppSnapshot, admission: AppSnapshotAdmission) {
    const admitted = { vault: false, semanticStatus: false, indexRevision: false };
    if (admission.generation !== this.#generation) return admitted;
    if (snapshot.watcherHealth) this.#admitWatcherHealth(snapshot.watcherHealth);
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

  async loadSettingsView() {
    const admission = this.#beginSnapshotAdmission('vault', 'semanticStatus');
    const view = await invoke<SettingsViewPayload>('get_settings_view');
    this.#admitSnapshot({ vault: view.vault, watcherHealth: view.watcherHealth, semanticStatus: view.semanticStatus }, admission);
    return { semanticSettings: view.semanticSettings, semanticDebug: view.semanticDebug };
  }

  async stageVaultSelection(path: string | null): Promise<VaultInfo | null> {
    const admission = this.#beginSnapshotAdmission('vault');
    const vault = await invoke<VaultInfo>('set_vault_directory', { path });
    this.#admitSnapshot({ vault }, admission);
    return this.vaultInfo;
  }

  async refreshVaultInfo(): Promise<void> {
    const admission = this.#beginSnapshotAdmission('vault');
    const vault = await invoke<VaultInfo>('get_vault_info');
    this.#admitSnapshot({ vault }, admission);
  }

  async refreshSemanticStatus(): Promise<void> {
    const admission = this.#beginSnapshotAdmission('semanticStatus');
    const semanticStatus = await invoke<SemanticStatus>('get_semantic_status');
    this.#admitSnapshot({ semanticStatus }, admission);
  }

  #admitWatcherHealth(health: WatcherHealth) {
    // This slice carries the native lifetime's revision. It orders snapshots
    // and callbacks even when IPC delivers them in a different order.
    if (!this.watcherHealth || health.revision > this.watcherHealth.revision) {
      this.watcherHealth = health;
    }
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

  async #createListeners(generation: number, scope: ListenerScope): Promise<() => void> {
    let admitted = false;
    const pendingEvents: Array<() => void> = [];
    const attach = <T>(channel: string, callback: (payload: T) => void) =>
      scope.acquire(() => listen<T>(channel, (event) => {
        if (scope.closed || generation !== this.#generation) return;
        if (admitted) callback(event.payload);
        else pendingEvents.push(() => callback(event.payload));
      }));
    await Promise.all([
      attach<WatcherHealth>('watcher-health-changed', payload => this.#admitWatcherHealth(payload)),
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
    return () => {
      if (scope.closed || generation !== this.#generation) return;
      admitted = true;
      for (const applyEvent of pendingEvents.splice(0)) applyEvent();
    };
  }
}

export const appStore = new AppStore();
