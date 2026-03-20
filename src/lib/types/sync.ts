export interface VaultInfo {
  currentPath: string;
  defaultPath: string;
  forgottenPath: string;
  isDefault: boolean;
  noteCount: number;
  requiresRestart: boolean;
}

export interface LinkedVaultState {
  vaultId: string | null;
  deviceId: string;
  linked: boolean;
}

export interface SyncStatus {
  deviceId: string;
  linkedVault: LinkedVaultState;
  paused: boolean;
  dirtyNoteCount: number;
  conflictedNoteCount: number;
  trackedNoteCount: number;
  lastSyncAtMillis: number | null;
  authEmail: string | null;
  syncBaseUrl: string | null;
  lastSyncError: string | null;
}

export interface SyncConflict {
  noteId: string;
  notePath: string;
  title: string;
  deleted: boolean;
  updatedAtMillis: number;
}

export interface SyncConflictDetail {
  conflict: SyncConflict;
  originalNoteId: string | null;
  originalNotePath: string | null;
  localMarkdown: string;
  remoteMarkdown: string;
}

export interface RequestMagicLinkResponse {
  accepted: boolean;
  expiresAt: string;
  magicLinkToken: string | null;
}
