import type { VaultInfo } from '#lib/types/vault.js';

export interface NativeContractSnapshot {
  ready: boolean;
  saved: Array<{ noteId: string | null; notePath: string | null; title: string; revision: number }>;
  changed: Array<{ notePath: string; deleted: boolean; documentKind?: 'note'; source?: string | null }>;
  vaults: VaultInfo[];
  vaultInfo: VaultInfo | null;
  indexRevision: number;
}

export interface NativeContractProbe {
  start(): void;
  read(): NativeContractSnapshot;
}
