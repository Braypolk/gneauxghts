import { invoke } from '@tauri-apps/api/core';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';

export function loadForgottenNotesSlice() {
  return invoke<ForgottenNoteSummary[]>('list_forgotten_notes');
}
