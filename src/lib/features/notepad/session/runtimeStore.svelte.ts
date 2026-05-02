import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import { createNotepadState } from '$lib/features/notepad/state/noteStore';

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

export const notepadState = notepadRuntimeState.notepadState;

export function updateSharedEditorResourceConfig(
  assetRootPath: string | null,
  storePastedImage: (file: File) => Promise<StoredImageAsset>
) {
  notepadRuntimeState.assetRootPath = assetRootPath;

  for (const runtime of documentRegistry.values()) {
    runtime.applyResourceConfig(assetRootPath, storePastedImage);
  }
}
