import { invoke } from '@tauri-apps/api/core';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';
import type { MissingNoteSummary } from '$lib/types/missingNotes';

export function loadForgottenNotesSlice() {
  return invoke<ForgottenNoteSummary[]>('list_forgotten_notes');
}

export function loadMissingNotesSlice() {
  return invoke<MissingNoteSummary[]>('list_missing_notes');
}
