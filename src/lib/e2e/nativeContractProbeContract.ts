import type { VaultInfo } from '$lib/types/vault';

export interface NativeContractSnapshot {
  ready: boolean;
  saved: Array<{ noteId: string | null; notePath: string | null; title: string; revision: number }>;
  changed: Array<{ notePath: string; deleted: boolean; documentKind?: 'note' | 'chatIndex' | 'chatTranscript'; source?: string | null; chatId?: string | null }>;
  vaults: VaultInfo[];
  vaultInfo: VaultInfo | null;
  indexRevision: number;
}

export interface NativeContractProbe {
  start(): void;
  read(): NativeContractSnapshot;
}
