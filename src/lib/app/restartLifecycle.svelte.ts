import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { awaitPendingNoteSave } from '$lib/features/notepad/navigation/pendingNoteSave';

export type RestartPhase = 'idle' | 'preparing' | 'readyToRestart' | 'failure';

export type PrepareRestartReceipt = {
  status: 'ready' | 'failed';
  ready: boolean;
  timelinePortable: boolean;
  canResume: boolean;
  error?: string;
};

/** One frontend action owns draft departure, backend settlement, and relaunch. */
export class RestartLifecycle {
  phase = $state<RestartPhase>('idle');
  error = $state<string | null>(null);
  timelinePortable = $state(false);
  workspaceMutationsBlocked = $state(false);

  #inFlight: Promise<void> | null = null;

  observeBackendPreparing() {
    if (this.phase === 'readyToRestart') return;
    this.phase = 'preparing';
    this.error = null;
    this.workspaceMutationsBlocked = true;
  }

  observeBackendReceipt(receipt: PrepareRestartReceipt) {
    this.timelinePortable = receipt.timelinePortable;
    this.phase = receipt.ready ? 'readyToRestart' : 'failure';
    this.error = receipt.error ?? null;
    this.workspaceMutationsBlocked = receipt.ready || !receipt.canResume;
  }

  restart(): Promise<void> {
    if (this.#inFlight) return this.#inFlight;
    if (this.phase === 'readyToRestart') {
      this.#inFlight = this.#requestRelaunch();
      return this.#inFlight;
    }
    if (this.phase === 'failure' && this.workspaceMutationsBlocked) {
      this.#inFlight = this.#prepareBackendAndRelaunch();
      return this.#inFlight;
    }
    this.#inFlight = this.#prepareAndRelaunch();
    return this.#inFlight;
  }

  async #prepareAndRelaunch(): Promise<void> {
    this.phase = 'preparing';
    this.error = null;
    this.workspaceMutationsBlocked = true;
    try {
      // The mounted Notepad handler first joins Version Restore, then the
      // existing shared workspace save/departure queue. No second save queue
      // is introduced for restart.
      await awaitPendingNoteSave();
    } catch (error) {
      this.phase = 'failure';
      this.error = String(error);
      this.workspaceMutationsBlocked = false;
      this.#inFlight = null;
      return;
    }

    await this.#prepareBackendAndRelaunch();
  }

  async #prepareBackendAndRelaunch(): Promise<void> {
    this.phase = 'preparing';
    this.error = null;
    this.workspaceMutationsBlocked = true;
    let receipt: PrepareRestartReceipt;
    try {
      receipt = await invoke<PrepareRestartReceipt>('prepare_restart');
    } catch (error) {
      // Once IPC dispatch begins, absence of a receipt cannot prove the
      // backend remained reversible. Stay inert and let Retry Restart join or
      // retry the backend lifecycle owner.
      this.phase = 'failure';
      this.error = String(error);
      this.workspaceMutationsBlocked = true;
      this.#inFlight = null;
      return;
    }
    this.timelinePortable = receipt.timelinePortable;
    if (!receipt.ready) {
      this.phase = 'failure';
      this.error = receipt.error ?? 'Restart preparation did not complete.';
      this.workspaceMutationsBlocked = !receipt.canResume;
      this.#inFlight = null;
      return;
    }

    this.phase = 'readyToRestart';
    await this.#requestRelaunch();
  }

  async #requestRelaunch(): Promise<void> {
    this.error = null;
    try {
      await relaunch();
    } catch (error) {
      // The backend is already cleanly closed. Keep the UI inert and offer
      // only another relaunch attempt; never imply editing resumed.
      this.phase = 'readyToRestart';
      this.error = String(error);
    } finally {
      this.#inFlight = null;
    }
  }
}

export const restartLifecycle = new RestartLifecycle();
