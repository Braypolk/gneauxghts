import type { GeneralSection } from './store';

export interface SettingsRefreshLoaders {
  loadSemanticState?: () => Promise<void>;
  loadSemanticStatus: () => Promise<void>;
  loadSyncState: (includeConflicts?: boolean) => Promise<void>;
  loadVaultInfo: () => Promise<void>;
  loadForgottenNotes: () => Promise<void>;
}

export function refreshSettingsForVisibility(
  activeGeneralSection: GeneralSection,
  loaders: SettingsRefreshLoaders
) {
  switch (activeGeneralSection) {
    case 'search':
    case 'ai':
      if (loaders.loadSemanticState) {
        return Promise.all([loaders.loadSemanticState(), loaders.loadSyncState(false)]);
      }
      return Promise.all([loaders.loadSemanticStatus(), loaders.loadSyncState(false)]);
    case 'sync':
      return loaders.loadSyncState(true);
    case 'vault':
      return Promise.all([loaders.loadVaultInfo(), loaders.loadSyncState(false)]);
    case 'forgetting':
      return loaders.loadForgottenNotes();
    default:
      return loaders.loadSemanticStatus();
  }
}

export function refreshSettingsAfterVaultChange(loaders: SettingsRefreshLoaders) {
  return Promise.all([loaders.loadSemanticStatus(), loaders.loadForgottenNotes()]);
}
