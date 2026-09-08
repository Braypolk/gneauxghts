import { describe, expect, it, vi } from 'vitest';
import {
  createPaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';

type PaneId = 'left' | 'right';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('pane navigation transition pipeline', () => {
  it('runs mutation phases in one deterministic order', async () => {
    const events: string[] = [];
    let resolvedOperationId: number | null = null;
    const pipeline =
      createPaneNavigationTransitionPipeline<PaneId>({
        assertWorkspaceInvariants: () =>
          events.push('assert'),
        ensurePaneEditors: async () => {
          events.push('ensure');
        }
      });

    const result = await pipeline.execute({
      kind: 'change-pane-kind',
      resolvePane: () => 'left',
      onResolved: (_paneId, operationId) => {
        resolvedOperationId = operationId;
        events.push('resolved');
      },
      guard: () => {
        events.push('guard');
        return { status: 'allow' };
      },
      departDocument: () => {
        events.push('depart');
      },
      captureHistory: () => {
        events.push('history');
      },
      prepare: async () => {
        events.push('prepare');
      },
      mutateWorkspace: () => {
        events.push('mutate');
      },
      ensureEditors: true,
      complete: () => {
        events.push('complete');
      },
      focus: () => {
        events.push('focus');
      }
    });

    expect(events).toEqual([
      'resolved',
      'guard',
      'depart',
      'history',
      'prepare',
      'mutate',
      'assert',
      'ensure',
      'complete',
      'focus'
    ]);
    expect(result).toMatchObject({
      status: 'applied',
      paneId: 'left',
      phases: [
        'resolved',
        'guarded',
        'document-departed',
        'history-captured',
        'prepared',
        'workspace-mutated',
        'editors-ensured',
        'completed',
        'focused'
      ]
    });
    expect(resolvedOperationId).toBe(result.operationId);
  });

  it.each([
    [
      { status: 'noop', reason: 'already selected' },
      'noop'
    ],
    [
      { status: 'blocked', reason: 'last editor' },
      'blocked'
    ]
  ] as const)(
    'returns a deterministic %s guard outcome',
    async (guard, expected) => {
      const mutate = vi.fn();
      const pipeline =
        createPaneNavigationTransitionPipeline<PaneId>({
          assertWorkspaceInvariants: vi.fn(),
          ensurePaneEditors: vi.fn(async () => undefined)
        });

      const result = await pipeline.execute({
        kind: 'switch-pane',
        resolvePane: () => 'left',
        guard: () => guard,
        mutateWorkspace: mutate
      });

      expect(result.status).toBe(expected);
      expect(result.reason).toBe(guard.reason);
      expect(mutate).not.toHaveBeenCalled();
    }
  );

  it('rejects an older async result for the same pane before mutation', async () => {
    const firstReady = deferred();
    const mutateFirst = vi.fn();
    const mutateSecond = vi.fn();
    const pipeline =
      createPaneNavigationTransitionPipeline<PaneId>({
        assertWorkspaceInvariants: vi.fn(),
        ensurePaneEditors: vi.fn(async () => undefined)
      });

    const first = pipeline.execute({
      kind: 'open-note',
      resolvePane: () => 'left',
      prepare: () => firstReady.promise,
      mutateWorkspace: mutateFirst
    });
    const second = await pipeline.execute({
      kind: 'open-note',
      resolvePane: () => 'left',
      mutateWorkspace: mutateSecond
    });
    firstReady.resolve();

    expect((await first).status).toBe('stale');
    expect(second.status).toBe('applied');
    expect(mutateFirst).not.toHaveBeenCalled();
    expect(mutateSecond).toHaveBeenCalledOnce();
  });

  it('allows simultaneous async transitions for different panes', async () => {
    const leftReady = deferred();
    const rightReady = deferred();
    const applied: PaneId[] = [];
    const pipeline =
      createPaneNavigationTransitionPipeline<PaneId>({
        assertWorkspaceInvariants: vi.fn(),
        ensurePaneEditors: vi.fn(async () => undefined)
      });

    const left = pipeline.execute({
      kind: 'open-note',
      resolvePane: () => 'left',
      prepare: () => leftReady.promise,
      mutateWorkspace: () => {
        applied.push('left');
      }
    });
    const right = pipeline.execute({
      kind: 'open-note',
      resolvePane: () => 'right',
      prepare: () => rightReady.promise,
      mutateWorkspace: () => {
        applied.push('right');
      }
    });
    rightReady.resolve();
    leftReady.resolve();

    expect((await left).status).toBe('applied');
    expect((await right).status).toBe('applied');
    expect(applied.sort()).toEqual(['left', 'right']);
  });
});

describe('departure queue ownership', () => {
  function pipeline() {
    return createPaneNavigationTransitionPipeline<PaneId>({
      assertWorkspaceInvariants: vi.fn(), ensurePaneEditors: vi.fn().mockResolvedValue(undefined)
    });
  }

  it('releases before completion so nested leaf work cannot deadlock', async () => {
    const transitions = pipeline();
    const result = await transitions.execute({
      kind: 'restore-location', resolvePane: () => 'left', trackLatestForPane: false,
      mutateWorkspace: async () => {
        expect((await transitions.execute({
          kind: 'open-note', resolvePane: () => 'left', departDocument: vi.fn(),
          complete: async () => {
            expect((await transitions.execute({
              kind: 'change-pane-kind', resolvePane: () => 'right', departDocument: vi.fn()
            })).status).toBe('applied');
          }
        })).status).toBe('applied');
      }
    });
    expect(result.status).toBe('applied');
  });

  it.each(['failure', 'stale', 'blocked'] as const)('releases after %s and permits the next departure', async mode => {
    const transitions = pipeline();
    const ready = deferred();
    const started = deferred();
    const cleanup = vi.fn();
    const first = transitions.execute({
      kind: 'close-pane', resolvePane: () => 'left',
      guard: async () => { started.resolve(); await ready.promise; return mode === 'blocked' ? { status: 'blocked', reason: 'guard' } : { status: 'allow' }; },
      departDocument: () => { if (mode === 'failure') throw new Error('seal failed'); },
      onFailed: cleanup, onStale: cleanup
    });
    await started.promise;
    const second = transitions.execute({
      kind: 'open-note', resolvePane: () => mode === 'stale' ? 'left' : 'right', departDocument: vi.fn()
    });
    ready.resolve();
    expect((await first).status).toBe(mode === 'failure' ? 'failed' : mode);
    expect((await second).status).toBe('applied');
    if (mode !== 'blocked') expect(cleanup).toHaveBeenCalledOnce();
  });
});
