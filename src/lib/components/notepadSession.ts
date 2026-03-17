import { invoke } from '@tauri-apps/api/core';
import { parseStoredMarkdown } from './notepadDocument';
import type { NoteSession } from './notepadTypes';
import type { ForgottenNoteSummary, RestoredForgottenNote } from '$lib/types/forgottenNotes';

export interface ForgottenNote {
  title: string;
  bodyMarkdown: string;
  currentNotePath: string | null;
  forgottenPath: string | null;
}

export interface NotepadDraft {
  title: string;
  bodyMarkdown: string;
  currentNotePath: string | null;
}

export interface NotepadSessionSnapshot extends NotepadDraft {
  lastSavedMarkdown: string;
  lastSavedPath: string | null;
}

export type NotepadSaveMode = 'autosave' | 'remember';

export function createEmptySessionSnapshot(): NotepadSessionSnapshot {
  return {
    title: '',
    bodyMarkdown: '',
    currentNotePath: null,
    lastSavedMarkdown: '',
    lastSavedPath: null
  };
}

export function hasNotepadContent(draft: NotepadDraft) {
  return draft.title.trim() !== '' || draft.bodyMarkdown.trim() !== '' || draft.currentNotePath !== null;
}

export function createForgottenNote(
  draft: NotepadDraft,
  forgottenPath: string | null = null
): ForgottenNote {
  return {
    title: draft.title,
    bodyMarkdown: draft.bodyMarkdown,
    currentNotePath: draft.currentNotePath,
    forgottenPath
  };
}

export function createSessionSnapshot(session: NoteSession): NotepadSessionSnapshot {
  const parsed = parseStoredMarkdown(session.markdown);

  return {
    title: parsed.title,
    bodyMarkdown: parsed.bodyMarkdown,
    currentNotePath: session.path,
    lastSavedMarkdown: session.markdown,
    lastSavedPath: session.path
  };
}

export function shouldSkipAutosave(
  markdown: string,
  currentNotePath: string | null,
  snapshot: Pick<NotepadSessionSnapshot, 'lastSavedMarkdown' | 'lastSavedPath'>
) {
  return markdown === snapshot.lastSavedMarkdown && currentNotePath === snapshot.lastSavedPath;
}

export async function loadSavedNoteSession() {
  const saved = await invoke<NoteSession>('load_note_session');
  return createSessionSnapshot(saved);
}

export async function openNoteSession(notePath: string) {
  const session = await invoke<NoteSession>('open_note', { path: notePath });
  return createSessionSnapshot(session);
}

export async function saveNoteSession(markdown: string, currentPath: string | null) {
  const saved = await invoke<NoteSession>('save_note', { markdown, currentPath });
  return createSessionSnapshot(saved);
}

export async function rememberNoteSession(markdown: string, currentPath: string | null) {
  await invoke('remember_note', { markdown, currentPath });
}

export async function forgetNoteSession(
  currentPath: string,
  retentionDays: 1 | 7 | 30
) {
  return invoke<ForgottenNoteSummary | null>('forget_note', { currentPath, retentionDays });
}

export async function restoreForgottenNotes(forgottenPaths: string[]) {
  return invoke<RestoredForgottenNote[]>('restore_forgotten_notes', { forgottenPaths });
}
