import { describe, expect, it } from 'vitest';
import { WorkspaceStore } from './workspaceStore.svelte';
import type { NotepadPaneId } from './workspaceStore.svelte';
import {
  createReadyPaneForTest,
  retirePaneForTest
} from './workspaceStoreTestSupport';

const first = 'notepad-pane-1' as NotepadPaneId;
const second = 'notepad-pane-2' as NotepadPaneId;
const third = 'notepad-pane-3' as NotepadPaneId;

function store() {
  return new WorkspaceStore(first, 'draft:workspace-1');
}

describe('WorkspaceStore pane commands', () => {
  it('keeps the split source pane distinct from its backing note', () => {
    const store = new WorkspaceStore();

    store.beginPaneCommand(
      'notepad-pane-2',
      'path:/vault/Context.md',
      'split',
      'notepad-pane-1'
    );

    expect(store.paneCommand).toMatchObject({
      paneId: 'notepad-pane-2',
      sourcePaneId: 'notepad-pane-1',
      sourceNoteKey: 'path:/vault/Context.md',
      mode: 'split'
    });

    store.resetPaneCommand();
    expect(store.paneCommand.sourcePaneId).toBeNull();
  });
});

describe('WorkspaceStore invariants', () => {
  it('adds pane structure and content reference atomically', () => {
    const workspace = store();

    createReadyPaneForTest(
      workspace,
      second,
      'path:/vault/Second.md',
      'chat'
    );

    expect(workspace.paneOrder).toEqual([first, second]);
    expect(workspace.getPaneState(second)).toEqual({
      paneId: second,
      kind: 'chat',
      noteKey: 'path:/vault/Second.md',
      chatConversationId: null
    });
  });

  it('allows chat-only workspaces while always retaining a pane', () => {
    const workspace = store();
    createReadyPaneForTest(
      workspace,
      second,
      'draft:workspace-2',
      'chat'
    );

    expect(workspace.setPaneKind(first, 'chat')).toBe(true);
    expect(workspace.getPaneState(first).kind).toBe('chat');
    expect(
      retirePaneForTest(workspace, first)?.pane.paneId
    ).toBe(first);
    expect(workspace.activePaneId).toBe(second);
    expect(retirePaneForTest(workspace, second)).toBeNull();
  });

  it('leases removed pane state until rendered teardown is finalized', () => {
    const workspace = store();
    createReadyPaneForTest(workspace, second, 'draft:workspace-2');

    const retirement = retirePaneForTest(workspace, second)!;

    expect(workspace.getPaneState(second).noteKey).toBe(
      'draft:workspace-2'
    );
    workspace.completePaneDisposal(
      second,
      retirement.operationId
    );
    expect(() => workspace.getPaneState(second)).toThrow(
      'Unknown workspace pane'
    );
  });

  it('selects the adjacent pane to the right, otherwise the left', () => {
    const workspace = store();
    createReadyPaneForTest(workspace, second, 'draft:workspace-2');
    createReadyPaneForTest(workspace, third, 'draft:workspace-3');

    workspace.setActivePaneId(second);
    retirePaneForTest(workspace, second);
    expect(workspace.activePaneId).toBe(third);

    retirePaneForTest(workspace, third);
    expect(workspace.activePaneId).toBe(first);
  });

  it('updates pane content and conversation through atomic commands', () => {
    const workspace = store();
    createReadyPaneForTest(
      workspace,
      second,
      'draft:workspace-2',
      'chat'
    );

    workspace.setPaneNoteKey(
      second,
      'path:/vault/Context.md'
    );
    workspace.setPaneConversationId(second, 'conversation-1');
    workspace.replaceNoteKeyReferences(
      'path:/vault/Context.md',
      'path:/vault/Renamed.md'
    );

    expect(workspace.getPaneState(second)).toMatchObject({
      noteKey: 'path:/vault/Renamed.md',
      chatConversationId: 'conversation-1'
    });
    expect(workspace.listReferencedNoteKeys()).toEqual([
      'draft:workspace-1',
      'path:/vault/Renamed.md'
    ]);
  });

  it('retains pane document identity across editor and chat transitions', () => {
    const workspace = store();
    createReadyPaneForTest(
      workspace,
      second,
      'path:/vault/Context.md',
      'editor'
    );
    workspace.setPaneConversationId(
      second,
      'conversation-1'
    );

    expect(workspace.setPaneKind(second, 'chat')).toBe(true);
    expect(workspace.getPaneState(second)).toMatchObject({
      kind: 'chat',
      noteKey: 'path:/vault/Context.md',
      chatConversationId: 'conversation-1'
    });

    expect(workspace.setPaneKind(second, 'editor')).toBe(
      true
    );
    expect(workspace.getPaneState(second)).toMatchObject({
      kind: 'editor',
      noteKey: 'path:/vault/Context.md',
      chatConversationId: null
    });
  });
});
