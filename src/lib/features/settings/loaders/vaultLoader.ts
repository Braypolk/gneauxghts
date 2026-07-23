import { invoke } from "@tauri-apps/api/core";
import type {
  CreateVaultFolderResult,
  VaultFolderInfo,
  VaultInfo
} from "$lib/types/vault";

export function loadVaultInfoSlice() {
  return invoke<VaultInfo>("get_vault_info");
}

export function listVaultFoldersSlice() {
  return invoke<VaultFolderInfo[]>("list_vault_folders");
}

export function createVaultFolderSlice(name: string) {
  return invoke<CreateVaultFolderResult>("create_vault_folder", { name });
}
