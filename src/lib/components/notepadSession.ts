import { invoke } from '@tauri-apps/api/core';
import { parseStoredMarkdown } from './notepadDocument';
import type { NoteSession, StoredImageAsset } from './notepadTypes';
import type { ForgottenNoteSummary, RestoredForgottenNote } from '$lib/types/forgottenNotes';
import type { VaultInfo } from '$lib/types/sync';

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

export async function loadCurrentVaultInfo() {
  return invoke<VaultInfo>('get_vault_info');
}

export async function openNoteSession(notePath: string) {
  const session = await invoke<NoteSession>('open_note', { path: notePath });
  return createSessionSnapshot(session);
}

export async function readNoteSession(notePath: string) {
  const session = await invoke<NoteSession>('read_note', { path: notePath });
  return createSessionSnapshot(session);
}

export async function saveNoteSession(markdown: string, currentPath: string | null) {
  const saved = await invoke<NoteSession>('save_note', { markdown, currentPath });
  return createSessionSnapshot(saved);
}

export async function rememberNoteSession(markdown: string, currentPath: string | null) {
  await invoke('remember_note', { markdown, currentPath });
}

function formatPastedImageTimestamp(date: Date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ];

  return parts.join('');
}

function extensionFromMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case 'image/avif':
      return 'avif';
    case 'image/bmp':
      return 'bmp';
    case 'image/gif':
      return 'gif';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

function buildPastedImageName(file: File) {
  const extensionFromName = file.name.split('.').pop()?.trim().toLowerCase() || null;
  const extension = extensionFromMimeType(file.type) ?? extensionFromName ?? 'png';

  return `Pasted image ${formatPastedImageTimestamp(new Date())}.${extension}`;
}

export async function storePastedImageAsset(file: File) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));

  return invoke<StoredImageAsset>('store_pasted_image', {
    bytes,
    originalName: buildPastedImageName(file),
    mimeType: file.type || null
  });
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
