import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceChoiceController } from './workspaceChoiceController';

const paneId = 'pane-1';

function setup() {
  let canSplit = true;
  const splitWorkspace = vi.fn(async () => undefined);
  const resolvePreviousLocation = vi.fn<
    (paneId: string) => Promise<unknown | null>
  >(async () => ({ noteId: 'previous' }));
  const resolvePaneCommandChoice = vi.fn(
    async () => undefined
  );
  const setPaneKind = vi.fn(async () => true);
  const goToPreviousLocation = vi.fn(
    async () => undefined
  );
  const controller = createWorkspaceChoiceController({
    canSplitWorkspace: () => canSplit,
    splitWorkspace,
    getPendingPaneCommandId: () => paneId,
    resolvePreviousLocation,
    resolvePaneCommandChoice,
    getActivePaneId: () => paneId,
    setPaneKind,
    goToPreviousLocation
  });
  return {
    controller,
    splitWorkspace,
    resolvePreviousLocation,
    resolvePaneCommandChoice,
    setPaneKind,
    goToPreviousLocation,
    disableSplit: () => {
      canSplit = false;
    }
  };
}

describe('workspace choice controller', () => {
  it('does not split below the supported viewport', async () => {
    const harness = setup();
    harness.disableSplit();

    await harness.controller.splitWorkspaceIfAllowed(
      'thoughtPartner'
    );

    expect(harness.splitWorkspace).not.toHaveBeenCalled();
    expect(
      harness.resolvePaneCommandChoice
    ).not.toHaveBeenCalled();
  });

  it('keeps the picker open when Previous has no target', async () => {
    const harness = setup();
    harness.resolvePreviousLocation.mockResolvedValue(null);

    await harness.controller.splitWorkspaceIfAllowed(
      'previous'
    );

    expect(harness.splitWorkspace).toHaveBeenCalledOnce();
    expect(
      harness.resolvePaneCommandChoice
    ).not.toHaveBeenCalled();
  });

  it('resolves available choices after splitting', async () => {
    const harness = setup();

    await harness.controller.splitWorkspaceIfAllowed(
      'thoughtPartner'
    );

    expect(
      harness.resolvePaneCommandChoice
    ).toHaveBeenCalledWith(paneId, 'thoughtPartner');
    expect(
      harness.resolvePreviousLocation
    ).toHaveBeenCalledWith(paneId);
  });

  it('maps current-pane choices to editor, chat, and history transitions', async () => {
    const harness = setup();

    await harness.controller.openPaneChoiceInCurrent(
      'current'
    );
    await harness.controller.openPaneChoiceInCurrent(
      'thoughtPartner'
    );
    await harness.controller.openPaneChoiceInCurrent(
      'previous'
    );

    expect(harness.setPaneKind).toHaveBeenNthCalledWith(
      1,
      paneId,
      'editor'
    );
    expect(harness.setPaneKind).toHaveBeenNthCalledWith(
      2,
      paneId,
      'chat'
    );
    expect(
      harness.goToPreviousLocation
    ).toHaveBeenCalledOnce();
  });
});
