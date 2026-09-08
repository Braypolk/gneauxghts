export interface VaultInfo {
  runningPath: string;
  selectedPath: string;
  defaultPath: string;
  forgottenPath: string;
  isDefault: boolean;
  noteCount: number;
  requiresRestart: boolean;
  canConfigurePath: boolean;
  canPickArbitraryPath: boolean;
  vaultContainerPath: string | null;
  pathConfigurationNote: string | null;
}

export interface VaultFolderInfo {
  name: string;
  path: string;
}

export interface CreateVaultFolderResult {
  createdPath: string;
  folders: VaultFolderInfo[];
}
