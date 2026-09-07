import type { SharedEditorResources } from '$lib/features/notepad/editor/editor';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { notepadRuntimeState } from '$lib/features/notepad/session/runtimeStore.svelte';
import { storePastedImageAsset } from '$lib/features/notepad/session/session';
import type {
  NoteDraftState,
  DocumentHandle
} from '$lib/features/notepad/state/noteStore';

/** Typed access to editor resources keyed by immutable open-document handle. */
export function getSharedEditorResources(
  document: NoteDraftState
): SharedEditorResources {
  return documentRegistry.ensure(document.handle).ensureResources({
    assetRootPath: notepadRuntimeState.assetRootPath,
    storePastedImage: storePastedImageAsset
  });
}

export function cleanupNoteRuntime(documentHandle: DocumentHandle): void {
  documentRegistry.dispose(documentHandle);
}
