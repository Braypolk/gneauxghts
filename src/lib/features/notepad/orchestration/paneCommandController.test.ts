import { describe, expect, it, vi } from 'vitest';
import { createPaneCommandController, type PaneCommandControllerDeps } from './paneCommandController';
import { createPaneNavigationTransitionPipeline } from './paneNavigationTransitionPipeline';
import { createEmptySessionSnapshot } from '../session/session';
import { createNoteDraftState } from '../state/noteStore';

function setup(resolvePreviousLocation: PaneCommandControllerDeps<string>['resolvePreviousLocation']) {
  let pending: string | null = 'target';
  const placeholder = createNoteDraftState(createEmptySessionSnapshot());
  const resetPaneCommand = vi.fn(() => { pending = null; });
  const restoreLocation = vi.fn(async () => undefined);
  const transitions = createPaneNavigationTransitionPipeline<string>({
    assertWorkspaceInvariants: () => {}, ensurePaneEditors: async () => {}
  });
  const controller = createPaneCommandController<string>({
    getPaneCommandPaneId: () => pending,
    getPaneCommandSourceDocumentHandle: () => null,
    findReferencePane: () => 'source',
    getPaneCommandMode: () => 'split',
    captureLocation: () => null,
    getPaneDocument: () => placeholder,
    getActivePaneId: () => 'target',
    resolvePreviousLocation,
    resetPaneCommand, restoreLocation, transitions,
    activatePane: vi.fn(),
    updateSelectedRelatedText: vi.fn(), scheduleSearch: vi.fn(), scheduleRelated: vi.fn()
  } as unknown as PaneCommandControllerDeps<string>);
  return { controller, resetPaneCommand, restoreLocation, transitions, getPending: () => pending };
}

describe('Previous pane command', () => {
  it('leaves the picker open when no previous location exists', async () => {
    const resolve = vi.fn(async () => null);
    const harness = setup(resolve);
    await harness.controller.resolvePaneCommandChoice('target', 'previous');
    expect(resolve).toHaveBeenCalledOnce();
    expect(harness.getPending()).toBe('target');
    expect(harness.resetPaneCommand).not.toHaveBeenCalled();
    expect(harness.restoreLocation).not.toHaveBeenCalled();
  });

  it('restores the single resolved target', async () => {
    const location = { kind: 'editor' as const, noteId: 'note', notePath: '/note.md' };
    const resolve = vi.fn(async () => location);
    const harness = setup(resolve);
    await harness.controller.resolvePaneCommandChoice('target', 'previous');
    expect(resolve).toHaveBeenCalledOnce();
    expect(harness.getPending()).toBeNull();
    expect(harness.restoreLocation).toHaveBeenCalledWith('target', location);
  });

  it('does not consume a picker or navigate from a superseded lookup', async () => {
    let release!: (value: null) => void;
    const lookup = vi.fn(() => new Promise<null>(resolve => { release = resolve; }));
    const harness = setup(lookup);
    const selection = harness.controller.resolvePaneCommandChoice('target', 'previous');
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    await harness.transitions.execute({ kind: 'open-note', resolvePane: () => 'target' });
    release(null);
    await selection;
    expect(harness.resetPaneCommand).not.toHaveBeenCalled();
    expect(harness.restoreLocation).not.toHaveBeenCalled();
  });
});
