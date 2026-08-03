import { describe, expect, it } from 'vitest';
import {
  adoptSnapshotForPane,
  createFreshDraftNote,
  createNoteDraftState,
  createNotepadState,
  getPaneNote,
  listReferencedNoteKeys,
  noteKeyFromPath,
  rekeyNote,
  removeNoteIfUnreferenced,
  replacePaneReferenceWithFreshDraft,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';
import {
  WorkspaceStore,
  type NotepadPaneId
} from '$lib/features/notepad/workspace/workspaceStore.svelte';
import {
  createReadyPaneForTest,
  retirePaneForTest
} from '$lib/features/notepad/workspace/workspaceStoreTestSupport';
import { notepadRuntimeState } from './runtimeStore.svelte';
import {
  updateDocumentMarkdown
} from '$lib/features/notepad/document/documentState';

const primary = 'notepad-pane-1' as NotepadPaneId;
const secondary = 'notepad-pane-2' as NotepadPaneId;

function setupWorkspace() {
  const initialNote = createNoteDraftState();
  const state = createNotepadState(initialNote);
  const workspace = new WorkspaceStore(
    primary,
    initialNote.key
  );
  createReadyPaneForTest(
    workspace,
    secondary,
    initialNote.key
  );
  return { state, workspace, initialNote };
}

describe('shared note identity', () => {
  it('two panes can reference the same note key', () => {
    const { state, workspace, initialNote } =
      setupWorkspace();

    expect(
      getPaneNote(state, workspace, primary)
    ).toBe(initialNote);
    expect(
      getPaneNote(state, workspace, secondary)
    ).toBe(initialNote);
    expect(listReferencedNoteKeys(workspace)).toEqual([
      initialNote.key
    ]);
  });

  it('edits in one pane update shared content visible to siblings', () => {
    const { state, workspace, initialNote } =
      setupWorkspace();

    updateDocumentMarkdown(initialNote, 'edited content');

    expect(
      getPaneNote(state, workspace, secondary).working.markdown
    ).toBe('edited content');
  });

  it('closing one pane does not delete a still-referenced note', () => {
    const { state, workspace, initialNote } =
      setupWorkspace();
    const fresh = createFreshDraftNote(state);
    workspace.setPaneNoteKey(primary, fresh.key);

    expect(
      getPaneNote(state, workspace, secondary)
    ).toBe(initialNote);
    expect(state.notesByKey[initialNote.key]).toBe(
      initialNote
    );
  });

  it('gives only the pane invoking Remember a fresh draft', () => {
    const { state, workspace, initialNote } =
      setupWorkspace();

    const fresh = replacePaneReferenceWithFreshDraft(
      state,
      workspace,
      primary
    );
    removeNoteIfUnreferenced(
      state,
      workspace,
      initialNote.key
    );

    expect(
      getPaneNote(state, workspace, primary)
    ).toBe(fresh);
    expect(
      getPaneNote(state, workspace, secondary)
    ).toBe(initialNote);
    expect(state.notesByKey[initialNote.key]).toBe(
      initialNote
    );
  });

  it('removes the old document after a single-pane Remember rebind', () => {
    const initialNote = createNoteDraftState();
    const state = createNotepadState(initialNote);
    const workspace = new WorkspaceStore(
      primary,
      initialNote.key
    );

    replacePaneReferenceWithFreshDraft(
      state,
      workspace,
      primary
    );
    removeNoteIfUnreferenced(
      state,
      workspace,
      initialNote.key
    );

    expect(state.notesByKey[initialNote.key]).toBeUndefined();
  });

  it('only removes a note after workspace references are gone', () => {
    const { state, workspace, initialNote } =
      setupWorkspace();

    removeNoteIfUnreferenced(
      state,
      workspace,
      initialNote.key
    );
    expect(state.notesByKey[initialNote.key]).toBe(
      initialNote
    );

    const fresh = createFreshDraftNote(state);
    workspace.setPaneNoteKey(primary, fresh.key);
    workspace.setPaneNoteKey(secondary, fresh.key);
    removeNoteIfUnreferenced(
      state,
      workspace,
      initialNote.key
    );

    expect(state.notesByKey[initialNote.key]).toBeUndefined();
  });
});

describe('rekey transfer', () => {
  it('rekeying a note updates all workspace references', () => {
    const { state, workspace, initialNote } =
      setupWorkspace();
    const oldKey = initialNote.key;
    const nextKey =
      noteKeyFromPath('/vault/Rekeyed.md') ??
      ('path:/vault/Rekeyed.md' as NoteKey);

    const rekeyed = rekeyNote(
      state,
      workspace,
      oldKey,
      nextKey
    );

    expect(rekeyed).toBe(initialNote);
    expect(rekeyed?.key).toBe(nextKey);
    expect(workspace.getPaneState(primary).noteKey).toBe(
      nextKey
    );
    expect(workspace.getPaneState(secondary).noteKey).toBe(
      nextKey
    );
    expect(state.notesByKey[oldKey]).toBeUndefined();
    expect(state.notesByKey[nextKey]).toBe(initialNote);
  });
});

describe('noteStore and WorkspaceStore ownership', () => {
  it('keeps runtime bootstrap state free of workspace and document mirrors', () => {
    expect(notepadRuntimeState).not.toHaveProperty('paneOrder');
    expect(notepadRuntimeState).not.toHaveProperty(
      'activePaneId'
    );
    expect(notepadRuntimeState).not.toHaveProperty(
      'notepadState'
    );
  });

  it('adopts a snapshot into documents and updates the workspace reference', () => {
    const { state, workspace } = setupWorkspace();
    const snapshot = {
      title: 'Updated Title',
      bodyMarkdown: 'updated body',
      currentNoteId: 'note-123',
      currentNotePath: '/vault/Note.md',
      lastSavedTitle: '',
      lastSavedMarkdown: '',
      lastSavedNoteId: null,
      lastSavedPath: null
    };

    const adopted = adoptSnapshotForPane(
      state,
      workspace,
      primary,
      snapshot
    );

    expect(adopted.working.title).toBe('Updated Title');
    expect(
      getPaneNote(state, workspace, primary)
    ).toBe(adopted);
    expect(state).not.toHaveProperty('panesById');
    expect(state).not.toHaveProperty('activePaneId');
  });

  it('removing pane state does not remove its document', () => {
    const { state, workspace } = setupWorkspace();
    const draft = createFreshDraftNote(state);
    workspace.setPaneNoteKey(secondary, draft.key);

    retirePaneForTest(workspace, secondary);

    expect(workspace.hasPane(secondary)).toBe(false);
    expect(state.notesByKey[draft.key]).toBe(draft);
  });
});
