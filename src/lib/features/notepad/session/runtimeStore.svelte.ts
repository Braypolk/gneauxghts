import type { EditorSnapshot, SharedEditorResources } from '$lib/features/notepad/editor/editor';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import { createNotepadState, type NoteKey } from '$lib/features/notepad/state/noteStore';

export const PRIMARY_PANE_ID = 'notepad-primary' as const;
export const SECONDARY_PANE_ID = 'notepad-secondary' as const;

export type NotepadPaneId = typeof PRIMARY_PANE_ID | typeof SECONDARY_PANE_ID;

export const notepadRuntimeState = $state({
  hasLoadedInitialSession: false,
  paneOrder: [PRIMARY_PANE_ID] as NotepadPaneId[],
  activePaneId: PRIMARY_PANE_ID as NotepadPaneId,
  notepadState: createNotepadState(PRIMARY_PANE_ID, [PRIMARY_PANE_ID, SECONDARY_PANE_ID] as const),
  assetRootPath: null as string | null
});

export const sharedEditorResourcesByNoteKey = new Map<NoteKey, SharedEditorResources>();
export const sharedEditorStateByNoteKey = new Map<NoteKey, EditorSnapshot | null>();
export const sharedEditorStateGenerationByNoteKey = new Map<NoteKey, number>();
export const noteSaveTimers = new Map<NoteKey, ReturnType<typeof window.setTimeout>>();
export const noteSaveQueues = new Map<NoteKey, Promise<void>>();
export const documentSyncFrameIds = new Map<NoteKey, number>();

export function updateSharedEditorResourceConfig(
  assetRootPath: string | null,
  storePastedImage: (file: File) => Promise<StoredImageAsset>
) {
  notepadRuntimeState.assetRootPath = assetRootPath;

  for (const resources of sharedEditorResourcesByNoteKey.values()) {
    resources.imagesConfig.assetRootPath = assetRootPath;
    resources.imagesConfig.storePastedImage = storePastedImage;
  }
}
