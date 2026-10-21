import type { PaneCommandChoice } from '#lib/features/notepad/paneCommandPicker.js';
import type { PaneKind } from '#lib/features/notepad/workspace/paneTypes.js';

export interface WorkspaceChoiceControllerDeps<
  TPaneId extends string
> {
  canSplitWorkspace: () => boolean;
  splitWorkspace: (choice?: PaneCommandChoice) => Promise<void>;
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

    await deps.splitWorkspace(choice);
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
