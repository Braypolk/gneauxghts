import type { SharedEditorResources } from '#lib/features/notepad/editor/editor.js';
import { documentRegistry } from '#lib/features/notepad/document/documentRegistry.js';
import { notepadRuntimeState } from '#lib/features/notepad/session/runtimeStore.svelte.js';
import { storePastedImageAsset } from '#lib/features/notepad/session/session.js';
import type {
  NoteDraftState,
  DocumentHandle
} from '#lib/features/notepad/state/noteStore.js';

/** Typed access to editor resources keyed by immutable open-document handle. */
export function getSharedEditorResources(
  document: NoteDraftState
): SharedEditorResources {
  return documentRegistry.ensure(document.handle).ensureResources({
    body: document.working.body,
    assetRootPath: notepadRuntimeState.assetRootPath,
    storePastedImage: storePastedImageAsset
  });
}

export function cleanupNoteRuntime(documentHandle: DocumentHandle): void {
  documentRegistry.dispose(documentHandle);
}
