import { invoke } from "@tauri-apps/api/core";
import type {
  NoteSession,
  StoredImageAsset,
} from "$lib/features/notepad/model/types";
import type {
  ForgottenNoteSummary,
  RestoredForgottenNote,
} from "$lib/types/forgottenNotes";
import type {
  CleanUpApplyPolicy,
  RememberActionOption,
  RememberDispatchResult,
} from "$lib/types/ai";
import type { VaultInfo } from "$lib/types/vault";

export interface ForgottenNote {
  title: string;
  bodyMarkdown: string;
  currentNoteId: string | null;
  currentNotePath: string | null;
  forgottenPath: string | null;
}

export interface Draft {
  title: string;
  bodyMarkdown: string;
  currentNoteId: string | null;
  currentNotePath: string | null;
}

export interface SessionSnapshot extends Draft {
  lastSavedTitle: string;
  lastSavedMarkdown: string;
  lastSavedNoteId: string | null;
  lastSavedPath: string | null;
}

export type SaveMode = "autosave" | "remember";

export function createEmptySessionSnapshot(): SessionSnapshot {
  return {
    title: "",
    bodyMarkdown: "",
    currentNoteId: null,
    currentNotePath: null,
    lastSavedTitle: "",
    lastSavedMarkdown: "",
    lastSavedNoteId: null,
    lastSavedPath: null,
  };
}

export function hasContent(draft: Draft) {
  return (
    draft.title.trim() !== "" ||
    draft.bodyMarkdown.trim() !== "" ||
    draft.currentNoteId !== null ||
    draft.currentNotePath !== null
  );
}

export function createForgottenNote(
  draft: Draft,
  forgottenPath: string | null = null,
): ForgottenNote {
  return {
    title: draft.title,
    bodyMarkdown: draft.bodyMarkdown,
    currentNoteId: draft.currentNoteId,
    currentNotePath: draft.currentNotePath,
    forgottenPath,
  };
}

export function createSessionSnapshot(session: NoteSession): SessionSnapshot {
  return {
    title: session.title,
    bodyMarkdown: session.markdown,
    currentNoteId: session.noteId,
    currentNotePath: session.path,
    lastSavedTitle: session.title,
    lastSavedMarkdown: session.markdown,
    lastSavedNoteId: session.noteId,
    lastSavedPath: session.path,
  };
}

export function shouldSkipAutosave(
  title: string,
  markdown: string,
  currentNoteId: string | null,
  currentNotePath: string | null,
  snapshot: Pick<
    SessionSnapshot,
    "lastSavedTitle" | "lastSavedMarkdown" | "lastSavedNoteId" | "lastSavedPath"
  >,
) {
  return (
    title === snapshot.lastSavedTitle &&
    markdown === snapshot.lastSavedMarkdown &&
    currentNoteId === snapshot.lastSavedNoteId &&
    currentNotePath === snapshot.lastSavedPath
  );
}

export async function loadSavedNoteSession() {
  const saved = await invoke<NoteSession>("load_note_session");
  return createSessionSnapshot(saved);
}

export async function loadCurrentVaultInfo() {
  return invoke<VaultInfo>("get_vault_info");
}

export function resolveAssetRootPath(vaultPath: string) {
  return `${vaultPath.replace(/[\\/]+$/u, "")}${vaultPath.includes("\\") ? "\\" : "/"}assets`;
}

export async function openNoteSession(
  noteId: string | null,
  notePath: string | null,
) {
  const session = await invoke<NoteSession>("open_note", {
    noteId,
    path: notePath,
  });
  return createSessionSnapshot(session);
}

export async function readNoteSession(
  noteId: string | null,
  notePath: string | null,
) {
  const session = await invoke<NoteSession>("read_note", {
    noteId,
    path: notePath,
  });
  return createSessionSnapshot(session);
}

export async function saveNoteSession(
  title: string,
  markdown: string,
  currentPath: string | null,
) {
  const saved = await invoke<NoteSession>("save_note", {
    title,
    markdown,
    currentPath,
  });
  return createSessionSnapshot(saved);
}

export async function rememberNoteSession(
  title: string,
  markdown: string,
  currentPath: string | null,
) {
  await invoke("remember_note", { title, markdown, currentPath });
}

export async function rememberWithAction(
  action: RememberActionOption,
  cleanUpApplyPolicy: CleanUpApplyPolicy,
  title: string,
  markdown: string,
  currentPath: string | null,
) {
  return invoke<RememberDispatchResult>("remember_with_action", {
    action,
    cleanUpApplyPolicy,
    title,
    markdown,
    currentPath,
  });
}

function formatPastedImageTimestamp(date: Date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];

  return parts.join("");
}

function extensionFromMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/avif":
      return "avif";
    case "image/bmp":
      return "bmp";
    case "image/gif":
      return "gif";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/svg+xml":
      return "svg";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function buildPastedImageName(file: File) {
  const extensionFromName =
    file.name.split(".").pop()?.trim().toLowerCase() || null;
  const extension =
    extensionFromMimeType(file.type) ?? extensionFromName ?? "png";

  return `Pasted image ${formatPastedImageTimestamp(new Date())}.${extension}`;
}

export async function storePastedImageAsset(file: File) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));

  return invoke<StoredImageAsset>("store_pasted_image", {
    bytes,
    originalName: buildPastedImageName(file),
    mimeType: file.type || null,
  });
}

export async function forgetNoteSession(
  currentPath: string,
  retentionDays: 1 | 7 | 30,
) {
  return invoke<ForgottenNoteSummary | null>("forget_note", {
    currentPath,
    retentionDays,
  });
}

export async function restoreForgottenNotes(forgottenPaths: string[]) {
  return invoke<RestoredForgottenNote[]>("restore_forgotten_notes", {
    forgottenPaths,
  });
}
