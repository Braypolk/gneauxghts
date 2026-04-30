export interface VaultInfo {
  currentPath: string;
  defaultPath: string;
  forgottenPath: string;
  isDefault: boolean;
  noteCount: number;
  requiresRestart: boolean;
  canConfigurePath: boolean;
  pathConfigurationNote: string | null;
}
