import {
  createSharedEditorResources,
  type EditorSnapshot,
  type SharedEditorResources
} from '$lib/features/notepad/editor/editor';
import {
  type NoteDraftState,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';
import {
  notepadRuntimeState,
  sharedEditorResourcesByNoteKey,
  sharedEditorStateByNoteKey,
  sharedEditorStateGenerationByNoteKey,
  noteSaveTimers,
  noteSaveQueues,
  documentSyncFrameIds
} from '$lib/features/notepad/session/runtimeStore.svelte';

/**
 * noteRuntime provides note-keyed shared state and persistence helpers.
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
  let resources = sharedEditorResourcesByNoteKey.get(document.key);
  if (resources) {
    return resources;
  }

  resources = createSharedEditorResources({
    assetRootPath: notepadRuntimeState.assetRootPath,
    onTaskListToggle: () => {
      // Caller is responsible for flushing the autosave.
    },
    onStorePastedImage: () => {
      // Placeholder — caller can override via updateSharedEditorResourceConfig.
      throw new Error('storePastedImage not configured');
    }
  });
  sharedEditorResourcesByNoteKey.set(document.key, resources);
  return resources;
}

// ---------------------------------------------------------------------------
// Shared editor state / generation (source of truth per NoteKey)
// ---------------------------------------------------------------------------

export function getSharedEditorStateGeneration(document: NoteDraftState): number {
  return sharedEditorStateGenerationByNoteKey.get(document.key) ?? 0;
}

export function setSharedEditorStateGeneration(document: NoteDraftState, generation: number): void {
  if (generation === 0) {
    sharedEditorStateGenerationByNoteKey.delete(document.key);
    return;
  }
  sharedEditorStateGenerationByNoteKey.set(document.key, generation);
}

export function bumpSharedEditorStateGeneration(document: NoteDraftState): number {
  const nextGeneration = getSharedEditorStateGeneration(document) + 1;
  sharedEditorStateGenerationByNoteKey.set(document.key, nextGeneration);
  return nextGeneration;
}

export function getSharedEditorState(document: NoteDraftState): EditorSnapshot | null {
  return sharedEditorStateByNoteKey.get(document.key) ?? null;
}

export function setSharedEditorState(
  document: NoteDraftState,
  editorState: EditorSnapshot | null
): void {
  if (editorState) {
    sharedEditorStateByNoteKey.set(document.key, editorState);
    return;
  }
  sharedEditorStateByNoteKey.delete(document.key);
}

// ---------------------------------------------------------------------------
// Persistence: save timers and queues (keyed by NoteKey)
// ---------------------------------------------------------------------------

export function getNoteSaveTimer(noteKey: NoteKey): ReturnType<typeof window.setTimeout> | undefined {
  return noteSaveTimers.get(noteKey);
}

export function setNoteSaveTimer(noteKey: NoteKey, timerId: ReturnType<typeof window.setTimeout>): void {
  noteSaveTimers.set(noteKey, timerId);
}

export function clearNoteSaveTimer(noteKey: NoteKey): void {
  const pending = noteSaveTimers.get(noteKey);
  if (pending) {
    window.clearTimeout(pending);
    noteSaveTimers.delete(noteKey);
  }
}

export function getNoteSaveQueue(noteKey: NoteKey): Promise<void> {
  return noteSaveQueues.get(noteKey) ?? Promise.resolve();
}

export function setNoteSaveQueue(noteKey: NoteKey, queue: Promise<void>): void {
  noteSaveQueues.set(noteKey, queue);
}

export function clearNoteSaveQueue(noteKey: NoteKey): void {
  noteSaveQueues.delete(noteKey);
}

// ---------------------------------------------------------------------------
// Document sync frames (keyed by NoteKey)
// ---------------------------------------------------------------------------

export function getDocumentSyncFrameId(noteKey: NoteKey): number | undefined {
  return documentSyncFrameIds.get(noteKey);
}

export function setDocumentSyncFrameId(noteKey: NoteKey, frameId: number): void {
  documentSyncFrameIds.set(noteKey, frameId);
}

export function clearDocumentSyncFrameId(noteKey: NoteKey): void {
  const frameId = documentSyncFrameIds.get(noteKey);
  if (frameId !== undefined) {
    window.cancelAnimationFrame(frameId);
    documentSyncFrameIds.delete(noteKey);
  }
}

export function hasDocumentSyncFrameId(noteKey: NoteKey): boolean {
  return documentSyncFrameIds.has(noteKey);
}

// ---------------------------------------------------------------------------
// Transfer / cleanup
// ---------------------------------------------------------------------------

/**
 * Transfer all note-keyed runtime data from `oldKey` to `nextKey`.
 * Used when a note's path changes and its NoteKey must be updated.
 */
export function transferNoteRuntime(oldKey: NoteKey, nextKey: NoteKey): void {
  if (oldKey === nextKey) {
    return;
  }

  const sharedEditorState = sharedEditorStateByNoteKey.get(oldKey);
  if (sharedEditorState && !sharedEditorStateByNoteKey.has(nextKey)) {
    sharedEditorStateByNoteKey.set(nextKey, sharedEditorState);
  }

  const generation = sharedEditorStateGenerationByNoteKey.get(oldKey);
  if (generation !== undefined && !sharedEditorStateGenerationByNoteKey.has(nextKey)) {
    sharedEditorStateGenerationByNoteKey.set(nextKey, generation);
  }

  const resources = sharedEditorResourcesByNoteKey.get(oldKey);
  if (resources && !sharedEditorResourcesByNoteKey.has(nextKey)) {
    sharedEditorResourcesByNoteKey.set(nextKey, resources);
  }

  const pendingTimer = noteSaveTimers.get(oldKey);
  if (pendingTimer && !noteSaveTimers.has(nextKey)) {
    noteSaveTimers.set(nextKey, pendingTimer);
  }

  const pendingQueue = noteSaveQueues.get(oldKey);
  if (pendingQueue && !noteSaveQueues.has(nextKey)) {
    noteSaveQueues.set(nextKey, pendingQueue);
  }

  const frameId = documentSyncFrameIds.get(oldKey);
  if (frameId !== undefined && !documentSyncFrameIds.has(nextKey)) {
    documentSyncFrameIds.set(nextKey, frameId);
  }

  const paneControllers = editorPaneControllersByNoteKey.get(oldKey);
  if (paneControllers) {
    const nextPaneControllers = editorPaneControllersByNoteKey.get(nextKey);
    if (nextPaneControllers) {
      for (const paneId of paneControllers) {
        nextPaneControllers.add(paneId);
      }
    } else {
      editorPaneControllersByNoteKey.set(nextKey, new Set(paneControllers));
    }
  }

  sharedEditorStateByNoteKey.delete(oldKey);
  sharedEditorStateGenerationByNoteKey.delete(oldKey);
  sharedEditorResourcesByNoteKey.delete(oldKey);
  noteSaveTimers.delete(oldKey);
  noteSaveQueues.delete(oldKey);
  documentSyncFrameIds.delete(oldKey);
  editorPaneControllersByNoteKey.delete(oldKey);
}

/**
 * Clean up all note-keyed runtime data for a note that is no longer referenced.
 */
export function cleanupNoteRuntime(noteKey: NoteKey): void {
  clearNoteSaveTimer(noteKey);
  clearDocumentSyncFrameId(noteKey);
  sharedEditorStateByNoteKey.delete(noteKey);
  sharedEditorStateGenerationByNoteKey.delete(noteKey);
  const resources = sharedEditorResourcesByNoteKey.get(noteKey);
  resources?.destroy();
  sharedEditorResourcesByNoteKey.delete(noteKey);
  clearNoteSaveQueue(noteKey);
  editorPaneControllersByNoteKey.delete(noteKey);
}

// ---------------------------------------------------------------------------
// Editor pane tracking (which controllers are attached per NoteKey)
// ---------------------------------------------------------------------------

const editorPaneControllersByNoteKey = new Map<NoteKey, Set<string>>();

export function registerEditorPaneForNote(noteKey: NoteKey, paneId: string): void {
  let controllers = editorPaneControllersByNoteKey.get(noteKey);
  if (!controllers) {
    controllers = new Set();
    editorPaneControllersByNoteKey.set(noteKey, controllers);
  }
  controllers.add(paneId);
}

export function unregisterEditorPaneForNote(noteKey: NoteKey, paneId: string): void {
  const controllers = editorPaneControllersByNoteKey.get(noteKey);
  if (controllers) {
    controllers.delete(paneId);
    if (controllers.size === 0) {
      editorPaneControllersByNoteKey.delete(noteKey);
    }
  }
}

export function getEditorPaneCountForNote(noteKey: NoteKey): number {
  return editorPaneControllersByNoteKey.get(noteKey)?.size ?? 0;
}
