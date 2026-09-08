import { invoke } from "@tauri-apps/api/core";
import type {
  CreateVaultFolderResult,
  VaultFolderInfo
} from "$lib/types/vault";

export function listVaultFoldersSlice() {
  return invoke<VaultFolderInfo[]>("list_vault_folders");
}

export function createVaultFolderSlice(name: string) {
  return invoke<CreateVaultFolderResult>("create_vault_folder", { name });
}
