import { invoke } from '@tauri-apps/api/core';

export function retrySemanticIndex() {
  return invoke<void>('retry_semantic_index');
}
