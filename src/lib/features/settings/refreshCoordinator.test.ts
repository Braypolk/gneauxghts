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
  it.each([
    ["search", "loadSemanticState"],
    ["vault", "loadVaultInfo"],
    ["forgetting", "loadForgottenNotes"],
  ] as const)("loads only the selected section for %s", async (section, selectedLoader) => {
    const loaders = createLoaders();

    await refreshSettingsForVisibility(section, loaders);

    for (const [name, loader] of Object.entries(loaders)) {
      expect(loader).toHaveBeenCalledTimes(name === selectedLoader ? 1 : 0);
    }
  });

  it("refreshes semantic status and forgotten notes after vault changes", async () => {
    const loaders = createLoaders();

    await refreshSettingsAfterVaultChange(loaders);

    expect(loaders.loadSemanticStatus).toHaveBeenCalledTimes(1);
    expect(loaders.loadForgottenNotes).toHaveBeenCalledTimes(1);
  });
});
