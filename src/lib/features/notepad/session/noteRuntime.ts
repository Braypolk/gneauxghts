import type { SharedEditorResources } from '$lib/features/notepad/editor/editor';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { notepadRuntimeState } from '$lib/features/notepad/session/runtimeStore.svelte';
import { storePastedImageAsset } from '$lib/features/notepad/session/session';
import type {
  NoteDraftState,
  NoteKey
} from '$lib/features/notepad/state/noteStore';

/** Typed access to note-keyed editor resources and persistence queues. */
export function getSharedEditorResources(
  document: NoteDraftState
): SharedEditorResources {
  return documentRegistry.ensure(document.key).ensureResources({
    assetRootPath: notepadRuntimeState.assetRootPath,
    storePastedImage: storePastedImageAsset
  });
}

export function getNoteSaveTimer(noteKey: NoteKey): number | undefined {
  return documentRegistry.get(noteKey)?.getSaveTimer() ?? undefined;
}

export function setNoteSaveTimer(noteKey: NoteKey, timerId: number): void {
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

export function transferNoteRuntime(oldKey: NoteKey, nextKey: NoteKey): void {
  documentRegistry.transfer(oldKey, nextKey);
}

export function cleanupNoteRuntime(noteKey: NoteKey): void {
  documentRegistry.dispose(noteKey);
}

export function getEditorPaneCountForNote(noteKey: NoteKey): number {
  return documentRegistry.get(noteKey)?.attachedPaneCount() ?? 0;
}
