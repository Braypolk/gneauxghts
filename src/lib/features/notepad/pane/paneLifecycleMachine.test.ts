import { describe, expect, it } from 'vitest';
import {
  createPaneEditorRuntimeState,
  createPaneMembershipState,
  transitionPaneEditorRuntime,
  transitionPaneMembership
} from './paneLifecycleMachine';

describe('pane membership machine', () => {
  it('uses the owning navigation operation for creation', () => {
    const creating = transitionPaneMembership(
      createPaneMembershipState(),
      { type: 'createRequested', operationId: 17 }
    );
    expect(creating).toEqual({
      kind: 'creating',
      operationId: 17
    });
    expect(
      transitionPaneMembership(creating, {
        type: 'creationCompleted',
        operationId: 17
      })
    ).toEqual({ kind: 'ready' });
  });

  it('returns a blocked close to ready', () => {
    const closing = transitionPaneMembership(
      createPaneMembershipState(true),
      { type: 'closeRequested', operationId: 23 }
    );
    expect(
      transitionPaneMembership(closing, {
        type: 'closeBlocked',
        operationId: 23
      })
    ).toEqual({ kind: 'ready' });
  });

  it('moves an allowed close through retirement and disposal', () => {
    const closing = transitionPaneMembership(
      createPaneMembershipState(true),
      { type: 'closeRequested', operationId: 31 }
    );
    const retiring = transitionPaneMembership(closing, {
      type: 'retirementStarted',
      operationId: 31
    });
    const disposed = transitionPaneMembership(retiring, {
      type: 'disposalCompleted',
      operationId: 31
    });

    expect(retiring).toEqual({
      kind: 'retiring',
      operationId: 31
    });
    expect(disposed).toEqual({ kind: 'disposed' });
  });

  it('rejects completions from another navigation operation', () => {
    const closing = transitionPaneMembership(
      createPaneMembershipState(true),
      { type: 'closeRequested', operationId: 41 }
    );
    for (const event of [
      { type: 'closeBlocked', operationId: 40 },
      { type: 'retirementStarted', operationId: 40 },
      { type: 'disposalCompleted', operationId: 40 }
    ] as const) {
      expect(transitionPaneMembership(closing, event)).toBe(
        closing
      );
    }
  });

  it('makes a failed creation terminal for that pane identity', () => {
    const creating = transitionPaneMembership(
      createPaneMembershipState(),
      { type: 'createRequested', operationId: 53 }
    );
    const disposed = transitionPaneMembership(creating, {
      type: 'creationFailed',
      operationId: 53
    });

    expect(disposed).toEqual({ kind: 'disposed' });
    expect(
      transitionPaneMembership(disposed, {
        type: 'createRequested',
        operationId: 54
      })
    ).toBe(disposed);
  });
});

describe('pane editor-runtime machine', () => {
  it('moves mount and ordinary unmount through explicit phases', () => {
    const mounting = transitionPaneEditorRuntime(
      createPaneEditorRuntimeState(),
      { type: 'mountRequested' }
    );
    const mounted = transitionPaneEditorRuntime(mounting, {
      type: 'mountCompleted'
    });
    const unmounting = transitionPaneEditorRuntime(mounted, {
      type: 'unmountRequested'
    });
    const unmounted = transitionPaneEditorRuntime(unmounting, {
      type: 'unmountCompleted'
    });

    expect(mounting).toEqual({ kind: 'mounting' });
    expect(mounted).toEqual({ kind: 'mounted' });
    expect(unmounting).toEqual({
      kind: 'unmounting',
      disposeAfter: false
    });
    expect(unmounted).toEqual({ kind: 'unmounted' });
  });

  it('supersedes an in-flight mount with terminal disposal', () => {
    const mounting = transitionPaneEditorRuntime(
      createPaneEditorRuntimeState(),
      { type: 'mountRequested' }
    );
    const disposing = transitionPaneEditorRuntime(mounting, {
      type: 'disposeRequested'
    });

    expect(disposing).toEqual({
      kind: 'unmounting',
      disposeAfter: true
    });
    expect(
      transitionPaneEditorRuntime(disposing, {
        type: 'mountCompleted'
      })
    ).toBe(disposing);
    expect(
      transitionPaneEditorRuntime(disposing, {
        type: 'unmountCompleted'
      })
    ).toEqual({ kind: 'disposed' });
  });

  it('recovers failed mount and ordinary unmount effects', () => {
    const mounting = transitionPaneEditorRuntime(
      createPaneEditorRuntimeState(),
      { type: 'mountRequested' }
    );
    expect(
      transitionPaneEditorRuntime(mounting, {
        type: 'mountFailed'
      })
    ).toEqual({ kind: 'unmounted' });

    const mounted = transitionPaneEditorRuntime(mounting, {
      type: 'mountCompleted'
    });
    const unmounting = transitionPaneEditorRuntime(mounted, {
      type: 'unmountRequested'
    });
    expect(
      transitionPaneEditorRuntime(unmounting, {
        type: 'unmountFailed'
      })
    ).toEqual({ kind: 'mounted' });
  });
});
