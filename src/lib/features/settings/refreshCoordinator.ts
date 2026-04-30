import type { GeneralSection } from "./store";

export interface SettingsRefreshLoaders {
  loadSemanticState?: () => Promise<void>;
  loadSemanticStatus: () => Promise<void>;
  loadVaultInfo: () => Promise<void>;
  loadForgottenNotes: () => Promise<void>;
}

export function refreshSettingsForVisibility(
  activeGeneralSection: GeneralSection,
  loaders: SettingsRefreshLoaders,
) {
  switch (activeGeneralSection) {
    case "search":
    case "ai":
      if (loaders.loadSemanticState) {
        return loaders.loadSemanticState();
      }
      return loaders.loadSemanticStatus();
    case "vault":
      return loaders.loadVaultInfo();
    case "forgetting":
      return loaders.loadForgottenNotes();
    default:
      return loaders.loadSemanticStatus();
  }
}

export function refreshSettingsAfterVaultChange(
  loaders: SettingsRefreshLoaders,
) {
  return Promise.all([
    loaders.loadSemanticStatus(),
    loaders.loadForgottenNotes(),
  ]);
}
