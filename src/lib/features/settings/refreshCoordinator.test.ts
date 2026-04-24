import { describe, expect, it, vi } from 'vitest';
import {
  refreshSettingsAfterVaultChange,
  refreshSettingsForVisibility,
  type SettingsRefreshLoaders
} from './refreshCoordinator';

function createLoaders(): SettingsRefreshLoaders {
  return {
    loadSemanticState: vi.fn().mockResolvedValue(undefined),
    loadSemanticStatus: vi.fn().mockResolvedValue(undefined),
    loadSyncState: vi.fn().mockResolvedValue(undefined),
    loadVaultInfo: vi.fn().mockResolvedValue(undefined),
    loadForgottenNotes: vi.fn().mockResolvedValue(undefined)
  };
}

describe('refreshCoordinator', () => {
  it('loads semantic state and lightweight sync state for search and AI visibility', async () => {
    const loaders = createLoaders();

    await refreshSettingsForVisibility('search', loaders);
    await refreshSettingsForVisibility('ai', loaders);

    expect(loaders.loadSemanticState).toHaveBeenCalledTimes(2);
    expect(loaders.loadSyncState).toHaveBeenCalledTimes(2);
    expect(loaders.loadSyncState).toHaveBeenCalledWith(false);
    expect(loaders.loadSemanticStatus).not.toHaveBeenCalled();
  });

  it('routes each general section to the minimal loader set', async () => {
    const loaders = createLoaders();

    await refreshSettingsForVisibility('sync', loaders);
    await refreshSettingsForVisibility('vault', loaders);
    await refreshSettingsForVisibility('forgetting', loaders);

    expect(loaders.loadSyncState).toHaveBeenCalledWith(true);
    expect(loaders.loadVaultInfo).toHaveBeenCalledTimes(1);
    expect(loaders.loadForgottenNotes).toHaveBeenCalledTimes(1);
  });

  it('refreshes semantic status and forgotten notes after vault changes', async () => {
    const loaders = createLoaders();

    await refreshSettingsAfterVaultChange(loaders);

    expect(loaders.loadSemanticStatus).toHaveBeenCalledTimes(1);
    expect(loaders.loadForgottenNotes).toHaveBeenCalledTimes(1);
    expect(loaders.loadSyncState).not.toHaveBeenCalled();
  });
});
