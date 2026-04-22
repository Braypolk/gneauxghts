import type { GeneralSection } from './store';

interface VisibilityRefreshLoaders {
  loadSemanticState: () => Promise<void>;
  loadSemanticStatus: () => Promise<void>;
  loadSyncState: (includeConflicts?: boolean) => Promise<void>;
  loadForgottenNotes: () => Promise<void>;
}

interface VaultChangeRefreshLoaders {
  loadSemanticStatus: () => Promise<void>;
  loadSyncState: (includeConflicts?: boolean) => Promise<void>;
  loadForgottenNotes: () => Promise<void>;
}

export function refreshSettingsForVisibility(
  activeGeneralSection: GeneralSection,
  loaders: VisibilityRefreshLoaders
) {
  if (activeGeneralSection === 'search') {
    return Promise.all([loaders.loadSemanticState(), loaders.loadForgottenNotes()]);
  }

  return Promise.all([
    loaders.loadSemanticStatus(),
    loaders.loadSyncState(true),
    loaders.loadForgottenNotes()
  ]);
}

export function refreshSettingsAfterVaultChange(loaders: VaultChangeRefreshLoaders) {
  return Promise.all([
    loaders.loadForgottenNotes(),
    loaders.loadSemanticStatus(),
    loaders.loadSyncState(false)
  ]);
}
