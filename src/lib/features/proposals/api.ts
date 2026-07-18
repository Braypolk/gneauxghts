import { invoke } from '@tauri-apps/api/core';
import type { ApplyNoteChangesResult, NoteChange } from '$lib/types/proposals';

export async function applyNoteChangeProposal(
  changes: NoteChange[]
): Promise<ApplyNoteChangesResult> {
  return invoke<ApplyNoteChangesResult>('apply_note_change_proposal', { changes });
}

export async function hashMarkdownContent(markdown: string): Promise<string> {
  return invoke<string>('hash_markdown_content', { markdown });
}
