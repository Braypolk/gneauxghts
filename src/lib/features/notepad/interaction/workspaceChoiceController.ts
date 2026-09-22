import type { PaneCommandChoice } from '$lib/features/notepad/paneCommandPicker';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';

export interface WorkspaceChoiceControllerDeps<
  TPaneId extends string
> {
  canSplitWorkspace: () => boolean;
  splitWorkspace: (initialKind?: PaneKind) => Promise<void>;
  getPendingPaneCommandId: () => TPaneId | null;
  resolvePaneCommandChoice: (
    paneId: TPaneId,
    choice: PaneCommandChoice
  ) => Promise<void>;
  getActivePaneId: () => TPaneId;
  setPaneKind: (
    paneId: TPaneId,
    kind: PaneKind
  ) => Promise<unknown>;
  goToPreviousLocation: () => Promise<unknown>;
}

/** Owns viewport-aware split and current-pane choice policy. */
export function createWorkspaceChoiceController<
  TPaneId extends string
>(deps: WorkspaceChoiceControllerDeps<TPaneId>) {
  function canSplitWorkspace() {
    return deps.canSplitWorkspace();
  }

  async function splitWorkspaceIfAllowed(
    choice?: PaneCommandChoice
  ) {
    if (!canSplitWorkspace()) return;

    if (choice === 'thoughtPartner') {
      await deps.splitWorkspace('chat');
      return;
    }
    await deps.splitWorkspace();
    if (!choice) return;

    const paneId = deps.getPendingPaneCommandId();
    if (!paneId) return;

    await deps.resolvePaneCommandChoice(paneId, choice);
  }

  async function openPaneChoiceInCurrent(
    choice: PaneCommandChoice
  ) {
    if (choice === 'current') {
      await deps.setPaneKind(
        deps.getActivePaneId(),
        'editor'
      );
    } else if (choice === 'thoughtPartner') {
      await deps.setPaneKind(
        deps.getActivePaneId(),
        'chat'
      );
    } else if (choice === 'previous') {
      await deps.goToPreviousLocation();
    }
  }

  return {
    canSplitWorkspace,
    splitWorkspaceIfAllowed,
    openPaneChoiceInCurrent
  };
}
