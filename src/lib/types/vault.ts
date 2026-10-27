export interface VaultInfo {
  runningPath: string;
  selectedPath: string;
  defaultPath: string;
  forgottenPath: string;
  isDefault: boolean;
  noteCount: number;
  requiresRestart: boolean;
  canConfigurePath: boolean;
  canRelaunch: boolean;
  canPickArbitraryPath: boolean;
  vaultContainerPath: string | null;
  pathConfigurationNote: string | null;
}

export interface WatcherHealth {
  revision: number;
  status: 'starting' | 'watching' | 'degraded' | 'unavailable' | 'stopped';
  reason: 'other' | 'permissionDenied' | 'watchLimit' | null;
  reconciliationRunning: boolean;
}

export interface VaultFolderInfo {
  name: string;
  path: string;
}

export interface CreateVaultFolderResult {
  createdPath: string;
  folders: VaultFolderInfo[];
}
