import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import { createNotepadState } from '$lib/features/notepad/state/noteStore';

export type NotepadPaneId = `notepad-pane-${number}`;

const INITIAL_PANE_ID: NotepadPaneId = 'notepad-pane-1';
let nextPaneIndex = 2;

export function createNotepadPaneId(): NotepadPaneId {
  const paneId = `notepad-pane-${nextPaneIndex}` as NotepadPaneId;
  nextPaneIndex += 1;
  return paneId;
}

export const notepadRuntimeState = $state({
  hasLoadedInitialSession: false,
  paneOrder: [INITIAL_PANE_ID] as NotepadPaneId[],
  activePaneId: INITIAL_PANE_ID as NotepadPaneId,
  notepadState: createNotepadState(INITIAL_PANE_ID, [INITIAL_PANE_ID] as const),
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
