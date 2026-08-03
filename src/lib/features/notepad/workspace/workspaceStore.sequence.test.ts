import { describe, expect, it } from 'vitest';
import {
  WorkspaceStore,
  type NotepadPaneId
} from './workspaceStore.svelte';
import type {
  NoteKey
} from '$lib/features/notepad/document/documentState';
import {
  createReadyPaneForTest,
  retirePaneForTest
} from './workspaceStoreTestSupport';

const first = 'notepad-pane-1' as NotepadPaneId;
const second = 'notepad-pane-2' as NotepadPaneId;
const third = 'notepad-pane-3' as NotepadPaneId;
const noteA = 'path:/vault/A.md' as NoteKey;
const noteB = 'path:/vault/B.md' as NoteKey;
const noteC = 'path:/vault/C.md' as NoteKey;

interface WorkspaceCommand {
  label: string;
  apply: (workspace: WorkspaceStore) => void;
}

function snapshotWorkspace(workspace: WorkspaceStore) {
  return {
    paneOrder: [...workspace.paneOrder],
    activePaneId: workspace.activePaneId,
    panes: workspace.paneOrder.map((paneId) => ({
      ...workspace.getPaneState(paneId)
    })),
    referencedNoteKeys: workspace.listReferencedNoteKeys(),
    memberships: [first, second, third].map((paneId) => ({
      paneId,
      state: workspace.getPaneMembership(paneId)
    }))
  };
}

function assertWorkspaceInvariants(workspace: WorkspaceStore) {
  workspace.assertInvariants();
  const order = workspace.paneOrder;
  if (order.length === 0) {
    throw new Error('workspace has no panes');
  }
  if (new Set(order).size !== order.length) {
    throw new Error('pane order contains duplicates');
  }
  if (!order.includes(workspace.activePaneId)) {
    throw new Error('active pane is not visible');
  }
  for (const paneId of order) {
    const membership = workspace.getPaneMembership(paneId);
    if (
      membership.kind !== 'ready' &&
      membership.kind !== 'closing'
    ) {
      throw new Error(
        `visible pane ${paneId} is ${membership.kind}`
      );
    }
  }
  const referenced = [
    ...new Set(
      order.map(
        (paneId) =>
          workspace.getPaneState(paneId).noteKey
      )
    )
  ];
  if (
    JSON.stringify(referenced) !==
    JSON.stringify(workspace.listReferencedNoteKeys())
  ) {
    throw new Error(
      'referenced-note projection diverged from pane state'
    );
  }
}

function removeCommand(
  paneId: NotepadPaneId
): WorkspaceCommand {
  return {
    label: `remove:${paneId}`,
    apply: (workspace) => {
      const before = [...workspace.paneOrder];
      const activeBefore = workspace.activePaneId;
      const index = before.indexOf(paneId);
      const expectedAdjacent =
        index === -1
          ? null
          : before[index + 1] ?? before[index - 1] ?? null;
      const removed = retirePaneForTest(workspace, paneId);
      if (
        removed &&
        activeBefore === paneId &&
        workspace.activePaneId !== expectedAdjacent
      ) {
        throw new Error(
          `active pane did not select adjacent pane after ${paneId}`
        );
      }
    }
  };
}

const commands: WorkspaceCommand[] = [
  {
    label: 'add:second:editor',
    apply: (workspace) => {
      createReadyPaneForTest(workspace, second, noteA, 'editor');
    }
  },
  {
    label: 'add:second:chat',
    apply: (workspace) => {
      createReadyPaneForTest(workspace, second, noteA, 'chat');
    }
  },
  {
    label: 'add:third:editor',
    apply: (workspace) => {
      createReadyPaneForTest(workspace, third, noteB, 'editor');
    }
  },
  {
    label: 'add:third:chat',
    apply: (workspace) => {
      createReadyPaneForTest(workspace, third, noteB, 'chat');
    }
  },
  ...[first, second, third].map(
    (paneId): WorkspaceCommand => ({
      label: `activate:${paneId}`,
      apply: (workspace) =>
        workspace.setActivePaneId(paneId)
    })
  ),
  ...[first, second, third].flatMap((paneId) =>
    (['editor', 'chat'] as const).map(
      (kind): WorkspaceCommand => ({
        label: `kind:${paneId}:${kind}`,
        apply: (workspace) => {
          workspace.setPaneKind(paneId, kind);
        }
      })
    )
  ),
  {
    label: 'reference:first:A',
    apply: (workspace) =>
      workspace.setPaneNoteKey(first, noteA)
  },
  {
    label: 'reference:second:A',
    apply: (workspace) =>
      workspace.setPaneNoteKey(second, noteA)
  },
  {
    label: 'reference:third:B',
    apply: (workspace) =>
      workspace.setPaneNoteKey(third, noteB)
  },
  {
    label: 'reference:replace:A:C',
    apply: (workspace) =>
      workspace.replaceNoteKeyReferences(noteA, noteC)
  },
  removeCommand(first),
  removeCommand(second),
  removeCommand(third)
];

describe('WorkspaceStore generated command sequences', () => {
  it('preserves atomic invariants across every command triple', () => {
    let attemptedCommands = 0;
    let rejectedCommands = 0;

    for (const firstCommand of commands) {
      for (const secondCommand of commands) {
        for (const thirdCommand of commands) {
          const sequence = [
            firstCommand,
            secondCommand,
            thirdCommand
          ];
          const workspace = new WorkspaceStore(
            first,
            'draft:sequence-root'
          );

          for (const command of sequence) {
            attemptedCommands += 1;
            const before = snapshotWorkspace(workspace);
            try {
              command.apply(workspace);
            } catch {
              rejectedCommands += 1;
              expect(
                snapshotWorkspace(workspace),
                `${sequence
                  .map((item) => item.label)
                  .join(' -> ')} must reject atomically`
              ).toEqual(before);
            }
            try {
              assertWorkspaceInvariants(workspace);
            } catch (error) {
              throw new Error(
                `${sequence
                  .map((item) => item.label)
                  .join(' -> ')} violated invariants after ${command.label}`,
                { cause: error }
              );
            }
          }
        }
      }
    }

    expect(attemptedCommands).toBe(
      commands.length ** 3 * 3
    );
    expect(rejectedCommands).toBeGreaterThan(0);
  });

  it.each([
    {
      active: first,
      close: first,
      expected: second
    },
    {
      active: second,
      close: second,
      expected: third
    },
    {
      active: third,
      close: third,
      expected: second
    }
  ])(
    'selects the adjacent pane for active close $close',
    ({ active, close, expected }) => {
      const workspace = new WorkspaceStore(
        first,
        'draft:sequence-root'
      );
      createReadyPaneForTest(workspace, second, noteA, 'editor');
      createReadyPaneForTest(workspace, third, noteB, 'editor');
      workspace.setActivePaneId(active);

      retirePaneForTest(workspace, close);

      expect(workspace.activePaneId).toBe(expected);
      assertWorkspaceInvariants(workspace);
    }
  );
});
