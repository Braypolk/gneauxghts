import {
  type EditorSnapshot,
  type SharedEditorResources
} from '$lib/features/notepad/editor/editor';
import { type NoteDraftState, type NoteKey } from '$lib/features/notepad/state/noteStore';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { notepadRuntimeState } from '$lib/features/notepad/session/runtimeStore.svelte';
import { storePastedImageAsset } from '$lib/features/notepad/session/session';

/**
 * noteRuntime provides note-keyed shared state and persistence helpers.
 *
 * Implementation: state is owned by the singleton DocumentRegistry, which
 * holds one DocumentRuntime per NoteKey. The functions here are thin
 * facades preserving the existing call sites' API.
 *
 * Invariant: note content is shared by NoteKey. Each pane that references
 * the same NoteKey sees the same note content. Editor snapshots, save
 * queues, and sync frames are keyed by NoteKey so that multiple panes
 * showing the same note cooperate instead of racing.
 */

// ---------------------------------------------------------------------------
// Shared editor resources (one set per NoteKey)
// ---------------------------------------------------------------------------

export function getSharedEditorResources(document: NoteDraftState): SharedEditorResources {
  const runtime = documentRegistry.ensure(document.key);
  return runtime.ensureResources({
    assetRootPath: notepadRuntimeState.assetRootPath,
    storePastedImage: storePastedImageAsset
  });
}

// ---------------------------------------------------------------------------
// Shared editor state / generation (source of truth per NoteKey)
// ---------------------------------------------------------------------------

export function getSharedEditorStateGeneration(document: NoteDraftState): number {
  return documentRegistry.get(document.key)?.getEditorGeneration() ?? 0;
}

export function setSharedEditorStateGeneration(document: NoteDraftState, generation: number): void {
  if (generation === 0) {
    documentRegistry.get(document.key)?.setEditorGeneration(0);
    return;
  }
  documentRegistry.ensure(document.key).setEditorGeneration(generation);
}

export function bumpSharedEditorStateGeneration(document: NoteDraftState): number {
  return documentRegistry.ensure(document.key).bumpEditorGeneration();
}

export function getSharedEditorState(document: NoteDraftState): EditorSnapshot | null {
  return documentRegistry.get(document.key)?.getEditorSnapshot() ?? null;
}

export function setSharedEditorState(
  document: NoteDraftState,
  editorState: EditorSnapshot | null
): void {
  if (editorState) {
    documentRegistry.ensure(document.key).setEditorSnapshot(editorState);
    return;
  }
  documentRegistry.get(document.key)?.setEditorSnapshot(null);
}

// ---------------------------------------------------------------------------
// Persistence: save timers and queues (keyed by NoteKey)
// ---------------------------------------------------------------------------

export function getNoteSaveTimer(noteKey: NoteKey): ReturnType<typeof window.setTimeout> | undefined {
  return documentRegistry.get(noteKey)?.getSaveTimer() ?? undefined;
}

export function setNoteSaveTimer(noteKey: NoteKey, timerId: ReturnType<typeof window.setTimeout>): void {
  documentRegistry.ensure(noteKey).setSaveTimer(timerId);
}

export function clearNoteSaveTimer(noteKey: NoteKey): void {
  documentRegistry.get(noteKey)?.clearSaveTimer();
}

export function getNoteSaveQueue(noteKey: NoteKey): Promise<void> {
  return documentRegistry.get(noteKey)?.getSaveQueue() ?? Promise.resolve();
}

export function setNoteSaveQueue(noteKey: NoteKey, queue: Promise<void>): void {
  documentRegistry.ensure(noteKey).setSaveQueue(queue);
}

export function clearNoteSaveQueue(noteKey: NoteKey): void {
  documentRegistry.get(noteKey)?.setSaveQueue(null);
}

// ---------------------------------------------------------------------------
// Document sync frames (keyed by NoteKey)
// ---------------------------------------------------------------------------

export function getDocumentSyncFrameId(noteKey: NoteKey): number | undefined {
  const runtime = documentRegistry.get(noteKey);
  if (!runtime || !runtime.hasSyncFrame()) return undefined;
  // The actual id is private; callers only need to know whether one exists,
  // and to clear it. This shim returns a sentinel positive number when set.
  return 1;
}

export function setDocumentSyncFrameId(noteKey: NoteKey, frameId: number): void {
  documentRegistry.ensure(noteKey).setSyncFrame(frameId);
}

export function clearDocumentSyncFrameId(noteKey: NoteKey): void {
  documentRegistry.get(noteKey)?.clearSyncFrame();
}

export function hasDocumentSyncFrameId(noteKey: NoteKey): boolean {
  return documentRegistry.get(noteKey)?.hasSyncFrame() ?? false;
}

// ---------------------------------------------------------------------------
// Transfer / cleanup
// ---------------------------------------------------------------------------

/**
 * Transfer all note-keyed runtime data from `oldKey` to `nextKey`.
 * Used when a note's path changes and its NoteKey must be updated.
 */
export function transferNoteRuntime(oldKey: NoteKey, nextKey: NoteKey): void {
  documentRegistry.transfer(oldKey, nextKey);
}

/**
 * Clean up all note-keyed runtime data for a note that is no longer referenced.
 */
export function cleanupNoteRuntime(noteKey: NoteKey): void {
  documentRegistry.dispose(noteKey);
}

// ---------------------------------------------------------------------------
// Editor pane tracking (which controllers are attached per NoteKey)
// ---------------------------------------------------------------------------

export function registerEditorPaneForNote(noteKey: NoteKey, paneId: string): void {
  documentRegistry.ensure(noteKey).attachPane(paneId);
}

export function unregisterEditorPaneForNote(noteKey: NoteKey, paneId: string): void {
  documentRegistry.get(noteKey)?.detachPane(paneId);
}

export function getEditorPaneCountForNote(noteKey: NoteKey): number {
  return documentRegistry.get(noteKey)?.attachedPaneCount() ?? 0;
}
