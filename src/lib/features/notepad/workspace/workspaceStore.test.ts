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
  return new WorkspaceStore(first, 'document:workspace-1');
}

describe('WorkspaceStore pane commands', () => {
  it('keeps the split source pane distinct from its backing note', () => {
    const store = new WorkspaceStore();

    store.beginPaneCommand(
      'notepad-pane-2',
      'document:/vault/Context.md',
      'split',
      'notepad-pane-1'
    );

    expect(store.paneCommand).toMatchObject({
      paneId: 'notepad-pane-2',
      sourcePaneId: 'notepad-pane-1',
      sourceDocumentHandle: 'document:/vault/Context.md',
      mode: 'split'
    });

    store.resetPaneCommand();
    expect(store.paneCommand.sourcePaneId).toBeNull();
  });
});

describe('WorkspaceStore invariants', () => {

  it('selects the adjacent pane to the right, otherwise the left', () => {
    const workspace = store();
    createReadyPaneForTest(workspace, second, 'document:workspace-2');
    createReadyPaneForTest(workspace, third, 'document:workspace-3');

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
      'document:workspace-2',
      'chat'
    );

    workspace.setPaneDocumentHandle(
      second,
      'document:/vault/Context.md'
    );
    workspace.setPaneConversationId(second, 'conversation-1');
    workspace.replaceDocumentHandleReferences(
      'document:/vault/Context.md',
      'document:/vault/Renamed.md'
    );

    expect(workspace.getPaneState(second)).toMatchObject({
      documentHandle: 'document:/vault/Renamed.md',
      chatConversationId: 'conversation-1'
    });
    expect(workspace.listReferencedDocumentHandles()).toEqual([
      'document:workspace-1',
      'document:/vault/Renamed.md'
    ]);
  });

  it('retains pane document identity across editor and chat transitions', () => {
    const workspace = store();
    createReadyPaneForTest(
      workspace,
      second,
      'document:/vault/Context.md',
      'editor'
    );
    workspace.setPaneConversationId(
      second,
      'conversation-1'
    );

    expect(workspace.setPaneKind(second, 'chat')).toBe(true);
    expect(workspace.getPaneState(second)).toMatchObject({
      kind: 'chat',
      documentHandle: 'document:/vault/Context.md',
      chatConversationId: 'conversation-1'
    });

    expect(workspace.setPaneKind(second, 'editor')).toBe(
      true
    );
    expect(workspace.getPaneState(second)).toMatchObject({
      kind: 'editor',
      documentHandle: 'document:/vault/Context.md',
      chatConversationId: null
    });
  });
});

describe('WorkspaceStore close destination', () => {
  it('selects the surviving chat before an active editor retires', () => {
    const workspace = store();
    createReadyPaneForTest(workspace, second, 'document:workspace-2', 'chat');
    workspace.setActivePaneId(first);
    workspace.beginPaneCollapse(first);
    expect(workspace.getActivePaneIdAfterClose(first)).toBe(second);
    expect(workspace.activePaneId).toBe(first);
    retirePaneForTest(workspace, first);
    expect(workspace.activePaneId).toBe(second);
  });

  it('uses the same right-then-left destination before and after retirement', () => {
    const workspace = store();
    createReadyPaneForTest(workspace, second, 'document:workspace-2', 'chat');
    createReadyPaneForTest(workspace, third, 'document:workspace-3', 'chat');
    workspace.setActivePaneId(second);
    expect(workspace.getActivePaneIdAfterClose(second)).toBe(third);
    retirePaneForTest(workspace, second);
    expect(workspace.activePaneId).toBe(third);
    expect(workspace.getActivePaneIdAfterClose(third)).toBe(first);
    retirePaneForTest(workspace, third);
    expect(workspace.activePaneId).toBe(first);
  });

  it('retains the active pane when an inactive pane closes or closing is cancelled', () => {
    const workspace = store();
    createReadyPaneForTest(workspace, second, 'document:workspace-2', 'chat');
    expect(workspace.getActivePaneIdAfterClose(second)).toBe(first);
    workspace.beginPaneCollapse(first);
    expect(workspace.getActivePaneIdAfterClose(first)).toBe(second);
    workspace.endPaneCollapse(first);
    expect(workspace.collapsingPaneId).toBeNull();
    expect(workspace.activePaneId).toBe(first);
  });
});
