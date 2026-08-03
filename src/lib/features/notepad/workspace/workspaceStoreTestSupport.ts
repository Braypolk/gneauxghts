import type { NoteKey } from '$lib/features/notepad/document/documentState';
import type { PaneKind } from './paneTypes';
import {
  WorkspaceStore,
  type NotepadPaneId
} from './workspaceStore.svelte';

export function createReadyPaneForTest(
  workspace: WorkspaceStore,
  paneId: NotepadPaneId,
  noteKey: NoteKey,
  kind: PaneKind = 'editor'
) {
  if (
    !workspace.dispatchPaneMembership(paneId, {
      type: 'createRequested',
      operationId: 1
    })
  ) {
    throw new Error(`Test pane could not start creating: ${paneId}`);
  }
  const membership = workspace.getPaneMembership(paneId);
  if (membership.kind !== 'creating') {
    throw new Error(`Test pane is not creating: ${paneId}`);
  }
  return workspace.completePaneCreation(
    paneId,
    membership.operationId,
    noteKey,
    kind
  );
}

export function retirePaneForTest(
  workspace: WorkspaceStore,
  paneId: NotepadPaneId
) {
  if (!workspace.canRemovePane(paneId)) return null;
  if (
    !workspace.dispatchPaneMembership(paneId, {
      type: 'closeRequested',
      operationId: 2
    })
  ) {
    return null;
  }
  const membership = workspace.getPaneMembership(paneId);
  if (membership.kind !== 'closing') return null;
  const pane = workspace.retirePane(
    paneId,
    membership.operationId
  );
  return pane
    ? { pane, operationId: membership.operationId }
    : null;
}
