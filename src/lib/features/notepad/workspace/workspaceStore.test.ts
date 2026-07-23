import { describe, expect, it } from 'vitest';
import { WorkspaceStore } from './workspaceStore.svelte';

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
