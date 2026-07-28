import { describe, expect, it } from 'vitest';
import { WorkspaceStore } from './workspaceStore.svelte';
import type { NotepadPaneId } from './workspaceStore.svelte';

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

    workspace.addPane(
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

  it('keeps at least one editor across kind changes and removals', () => {
    const workspace = store();
    workspace.addPane(second, 'draft:workspace-2', 'chat');

    expect(workspace.setPaneKind(first, 'chat')).toBe(false);
    expect(workspace.getPaneState(first).kind).toBe('editor');
    expect(workspace.removePane(first)).toBeNull();

    expect(workspace.setPaneKind(second, 'editor')).toBe(true);
    expect(workspace.removePane(first)?.paneId).toBe(first);
    expect(workspace.activePaneId).toBe(second);
  });

  it('selects the adjacent pane to the right, otherwise the left', () => {
    const workspace = store();
    workspace.addPane(second, 'draft:workspace-2');
    workspace.addPane(third, 'draft:workspace-3');

    workspace.setActivePaneId(second);
    workspace.removePane(second);
    expect(workspace.activePaneId).toBe(third);

    workspace.removePane(third);
    expect(workspace.activePaneId).toBe(first);
  });

  it('updates pane content and conversation through atomic commands', () => {
    const workspace = store();
    workspace.addPane(second, 'draft:workspace-2', 'chat');

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
    workspace.addPane(
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
