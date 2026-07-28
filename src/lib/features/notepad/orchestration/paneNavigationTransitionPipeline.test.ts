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
      guard: () => {
        events.push('guard');
        return { status: 'allow' };
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
      'guard',
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
        'history-captured',
        'prepared',
        'workspace-mutated',
        'editors-ensured',
        'completed',
        'focused'
      ]
    });
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
