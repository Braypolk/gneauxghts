import { invoke } from "@tauri-apps/api/core";
import type { VaultInfo } from "$lib/types/vault";

export function loadVaultInfoSlice() {
  return invoke<VaultInfo>("get_vault_info");
}
