import { describe, expect, it, vi } from "vitest";
import {
  refreshSettingsAfterVaultChange,
  refreshSettingsForVisibility,
  type SettingsRefreshLoaders,
} from "./refreshCoordinator";

function createLoaders(): SettingsRefreshLoaders {
  return {
    loadSemanticState: vi.fn().mockResolvedValue(undefined),
    loadSemanticStatus: vi.fn().mockResolvedValue(undefined),
    loadVaultInfo: vi.fn().mockResolvedValue(undefined),
    loadForgottenNotes: vi.fn().mockResolvedValue(undefined),
  };
}

describe("refreshCoordinator", () => {
  it("loads semantic state for search visibility", async () => {
    const loaders = createLoaders();

    await refreshSettingsForVisibility("search", loaders);

    expect(loaders.loadSemanticState).toHaveBeenCalledTimes(1);
    expect(loaders.loadSemanticStatus).not.toHaveBeenCalled();
  });

  it("routes each general section to the minimal loader set", async () => {
    const loaders = createLoaders();

    await refreshSettingsForVisibility("vault", loaders);
    await refreshSettingsForVisibility("forgetting", loaders);

    expect(loaders.loadVaultInfo).toHaveBeenCalledTimes(1);
    expect(loaders.loadForgottenNotes).toHaveBeenCalledTimes(1);
  });

  it("refreshes semantic status and forgotten notes after vault changes", async () => {
    const loaders = createLoaders();

    await refreshSettingsAfterVaultChange(loaders);

    expect(loaders.loadSemanticStatus).toHaveBeenCalledTimes(1);
    expect(loaders.loadForgottenNotes).toHaveBeenCalledTimes(1);
  });
});
