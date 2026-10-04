import { describe, expect, it } from 'vitest';
import {
  WorkspaceStore,
  type NotepadPaneId
} from './workspaceStore.svelte';
import type {
  DocumentHandle
} from '$lib/features/notepad/document/documentState';
import {
  createReadyPaneForTest,
  retirePaneForTest
} from './workspaceStoreTestSupport';

const first = 'notepad-pane-1' as NotepadPaneId;
const second = 'notepad-pane-2' as NotepadPaneId;
const third = 'notepad-pane-3' as NotepadPaneId;
const noteA = 'document:/vault/A.md' as DocumentHandle;
const noteB = 'document:/vault/B.md' as DocumentHandle;
const noteC = 'document:/vault/C.md' as DocumentHandle;

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
    referencedDocumentHandles: workspace.listReferencedDocumentHandles(),
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
          workspace.getPaneState(paneId).documentHandle
      )
    )
  ];
  if (
    JSON.stringify(referenced) !==
    JSON.stringify(workspace.listReferencedDocumentHandles())
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
      workspace.setPaneDocumentHandle(first, noteA)
  },
  {
    label: 'reference:second:A',
    apply: (workspace) =>
      workspace.setPaneDocumentHandle(second, noteA)
  },
  {
    label: 'reference:third:B',
    apply: (workspace) =>
      workspace.setPaneDocumentHandle(third, noteB)
  },
  {
    label: 'reference:replace:A:C',
    apply: (workspace) =>
      workspace.replaceDocumentHandleReferences(noteA, noteC)
  },
  removeCommand(first),
  removeCommand(second),
  removeCommand(third)
];

// The oracle models public outcomes independently of WorkspaceStore/reducers.
// Retired panes retain their records until disposal, but cannot be activated.
function createModel() {
  return {
    order: [first], active: first,
    panes: new Map<NotepadPaneId, { kind: 'editor' | 'chat'; documentHandle: DocumentHandle }>([
      [first, { kind: 'editor', documentHandle: 'document:sequence-root' }]
    ])
  };
}
function applyModel(model: ReturnType<typeof createModel>, label: string): boolean {
  const [operation, target, value] = label.split(':');
  const paneId = (new Map<string, NotepadPaneId>(Object.entries({ first, second, third })).get(target) ?? target) as NotepadPaneId;
  const pane = model.panes.get(paneId);
  const visible = model.order.includes(paneId);
  const handles = { A: noteA, B: noteB, C: noteC };
  switch (operation) {
    case 'add':
      if (pane) return false;
      model.panes.set(paneId, { kind: value as 'editor' | 'chat', documentHandle: paneId === second ? noteA : noteB });
      model.order.push(paneId);
      break;
    case 'activate':
      if (!visible) return false;
      model.active = paneId;
      break;
    case 'kind':
      if (!pane) return false;
      if (visible) pane.kind = value as 'editor' | 'chat';
      break;
    case 'reference':
      if (target === 'replace') {
        for (const id of model.order) {
          const item = model.panes.get(id)!;
          if (item.documentHandle === noteA) item.documentHandle = noteC;
        }
      } else {
        if (!pane) return false;
        pane.documentHandle = handles[value as keyof typeof handles];
      }
      break;
    case 'remove':
      if (!visible || model.order.length === 1) break;
      const index = model.order.indexOf(paneId);
      if (model.active === paneId) model.active = model.order[index + 1] ?? model.order[index - 1];
      model.order.splice(index, 1);
      break;
    default: throw new Error(`Unknown model command: ${label}`);
  }
  return true;
}
function applyAndCheck(workspace: WorkspaceStore, model: ReturnType<typeof createModel>, command: WorkspaceCommand) {
  const before = snapshotWorkspace(workspace);
  const accepted = applyModel(model, command.label);
  if (accepted) {
    // Do not catch: a valid command throwing is a regression, even if atomic.
    command.apply(workspace);
  } else {
    expect(() => command.apply(workspace), command.label).toThrow();
    expect(snapshotWorkspace(workspace), command.label).toEqual(before);
  }
  expect([...workspace.paneOrder], command.label).toEqual(model.order);
  expect(workspace.activePaneId, command.label).toBe(model.active);
  for (const [id, expected] of model.panes) {
    expect(workspace.getPaneState(id), command.label).toMatchObject(expected);
  }
  assertWorkspaceInvariants(workspace);
  return accepted;
}

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
            'document:sequence-root'
          );

          const model = createModel();
          for (const command of sequence) {
            attemptedCommands += 1;
            if (!applyAndCheck(workspace, model, command)) rejectedCommands += 1;
          }
        }
      }
    }

    expect(attemptedCommands).toBe(
      commands.length ** 3 * 3
    );
    expect(rejectedCommands).toBeGreaterThan(0);
  });

  it('preserves membership through close, disposal, replacement and a second close', () => {
    const workspace = new WorkspaceStore(first, 'document:sequence-root');
    createReadyPaneForTest(workspace, second, noteA);
    workspace.setActivePaneId(second);
    const retired = retirePaneForTest(workspace, second)!;
    expect(workspace.getPaneState(second).documentHandle).toBe(noteA);
    expect(workspace.activePaneId).toBe(first);
    expect(workspace.completePaneDisposal(second, retired.operationId + 1)).toBe(false);
    expect(workspace.completePaneDisposal(second, retired.operationId)).toBe(true);
    expect(() => createReadyPaneForTest(workspace, second, noteB, 'chat')).toThrow();
    createReadyPaneForTest(workspace, third, noteB, 'chat');
    workspace.setActivePaneId(third);
    expect(retirePaneForTest(workspace, first)).not.toBeNull();
    expect(workspace.paneOrder).toEqual([third]);
    expect(workspace.getPaneState(third).documentHandle).toBe(noteB);
    expect(retirePaneForTest(workspace, third)).toBeNull();
    assertWorkspaceInvariants(workspace);
  });
});
