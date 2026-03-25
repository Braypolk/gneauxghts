import { invoke } from '@tauri-apps/api/core';
import type { NoteSession, StoredImageAsset } from '$lib/features/notepad/model/types';
import type { ForgottenNoteSummary, RestoredForgottenNote } from '$lib/types/forgottenNotes';
import type { VaultInfo } from '$lib/types/sync';

export interface ForgottenNote {
  title: string;
  bodyMarkdown: string;
  currentNotePath: string | null;
  forgottenPath: string | null;
}

export interface Draft {
  title: string;
  bodyMarkdown: string;
  currentNotePath: string | null;
}

export interface SessionSnapshot extends Draft {
  lastSavedTitle: string;
  lastSavedMarkdown: string;
  lastSavedPath: string | null;
}

export type SaveMode = 'autosave' | 'remember';

export function createEmptySessionSnapshot(): SessionSnapshot {
  return {
    title: '',
    bodyMarkdown: '',
    currentNotePath: null,
    lastSavedTitle: '',
    lastSavedMarkdown: '',
    lastSavedPath: null
  };
}

export function hasContent(draft: Draft) {
  return draft.title.trim() !== '' || draft.bodyMarkdown.trim() !== '' || draft.currentNotePath !== null;
}

export function createForgottenNote(
  draft: Draft,
  forgottenPath: string | null = null
): ForgottenNote {
  return {
    title: draft.title,
    bodyMarkdown: draft.bodyMarkdown,
    currentNotePath: draft.currentNotePath,
    forgottenPath
  };
}

export function createSessionSnapshot(session: NoteSession): SessionSnapshot {
  return {
    title: session.title,
    bodyMarkdown: session.markdown,
    currentNotePath: session.path,
    lastSavedTitle: session.title,
    lastSavedMarkdown: session.markdown,
    lastSavedPath: session.path
  };
}

export function shouldSkipAutosave(
  title: string,
  markdown: string,
  currentNotePath: string | null,
  snapshot: Pick<SessionSnapshot, 'lastSavedTitle' | 'lastSavedMarkdown' | 'lastSavedPath'>
) {
  return (
    title === snapshot.lastSavedTitle &&
    markdown === snapshot.lastSavedMarkdown &&
    currentNotePath === snapshot.lastSavedPath
  );
}

export async function loadSavedNoteSession() {
  const saved = await invoke<NoteSession>('load_note_session');
  return createSessionSnapshot(saved);
}

export async function loadCurrentVaultInfo() {
  return invoke<VaultInfo>('get_vault_info');
}

export function resolveAssetRootPath(vaultPath: string) {
  return `${vaultPath.replace(/[\\/]+$/u, '')}${vaultPath.includes('\\') ? '\\' : '/'}assets`;
}

export async function openNoteSession(notePath: string) {
  const session = await invoke<NoteSession>('open_note', { path: notePath });
  return createSessionSnapshot(session);
}

export async function readNoteSession(notePath: string) {
  const session = await invoke<NoteSession>('read_note', { path: notePath });
  return createSessionSnapshot(session);
}

export async function saveNoteSession(
  title: string,
  markdown: string,
  currentPath: string | null
) {
  const saved = await invoke<NoteSession>('save_note', { title, markdown, currentPath });
  return createSessionSnapshot(saved);
}

export async function rememberNoteSession(
  title: string,
  markdown: string,
  currentPath: string | null
) {
  await invoke('remember_note', { title, markdown, currentPath });
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
