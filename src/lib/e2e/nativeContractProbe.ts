import type { NativeContractProbe } from './nativeContractProbeContract';
export type { NativeContractProbe } from './nativeContractProbeContract';
import { appStore } from '#lib/app/appStore.svelte.js';

type SavedEvent = Parameters<Parameters<typeof appStore.subscribeNoteSaved>[0]>[0];
type ChangedEvent = Parameters<Parameters<typeof appStore.subscribeVaultNoteChanged>[0]>[0];
type VaultEvent = Parameters<Parameters<typeof appStore.subscribeVaultChanged>[0]>[0];

/** Observe the production consumer after real Tauri event admission. Never emits. */
export function createNativeContractProbe(): NativeContractProbe & { dispose(): void } {
  const saved: SavedEvent[] = [];
  const changed: ChangedEvent[] = [];
  const vaults: VaultEvent[] = [];
  const release = [
    appStore.subscribeNoteSaved(event => saved.push({ ...event })),
    appStore.subscribeVaultNoteChanged(event => changed.push({ ...event })),
    appStore.subscribeVaultChanged(event => vaults.push({ ...event }))
  ];
  return {
    start() { saved.length = 0; changed.length = 0; vaults.length = 0; },
    read() {
      return {
        ready: appStore.ready,
        saved: saved.map(event => ({ ...event })),
        changed: changed.map(event => ({ ...event })),
        vaults: vaults.map(event => ({ ...event })),
        vaultInfo: appStore.vaultInfo ? { ...appStore.vaultInfo } : null,
        indexRevision: appStore.indexRevision
      };
    },
    dispose() { for (const dispose of release) dispose(); }
  };
}
