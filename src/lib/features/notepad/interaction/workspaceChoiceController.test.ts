import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceChoiceController } from './workspaceChoiceController';

const paneId = 'pane-1';

function setup() {
  let canSplit = true;
  const splitWorkspace = vi.fn(async () => undefined);
  const setPaneKind = vi.fn(async () => true);
  const goToPreviousLocation = vi.fn(
    async () => undefined
  );
  const controller = createWorkspaceChoiceController({
    canSplitWorkspace: () => canSplit,
    splitWorkspace,
    getActivePaneId: () => paneId,
    setPaneKind,
    goToPreviousLocation
  });
  return {
    controller,
    splitWorkspace,
    setPaneKind,
    goToPreviousLocation,
    disableSplit: () => {
      canSplit = false;
    }
  };
}

describe('workspace choice controller', () => {
  it('does not split when workspace admission disallows it', async () => {
    const harness = setup();
    harness.disableSplit();

    await harness.controller.splitWorkspaceIfAllowed(
      'thoughtPartner'
    );

    expect(harness.splitWorkspace).not.toHaveBeenCalled();
  });

  it('passes the destination into one split command', async () => {
    const harness = setup();
    await harness.controller.splitWorkspaceIfAllowed('previous');
    expect(harness.splitWorkspace).toHaveBeenCalledOnce();
    expect(harness.splitWorkspace).toHaveBeenCalledWith('previous');
  });

  it('creates a chat destination without an intermediate pane command', async () => {
    const harness = setup();
    await harness.controller.splitWorkspaceIfAllowed('thoughtPartner');
    expect(harness.splitWorkspace).toHaveBeenCalledWith('thoughtPartner');
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
