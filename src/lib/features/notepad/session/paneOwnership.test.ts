import { describe, expect, it } from 'vitest';
import {
  adoptCommittedDocument,
  adoptSnapshotForPane,
  bindNotepadStateToVault,
  createFreshDraftNote,
  createNoteDraftState,
  createNotepadState,
  getPaneNote,
  listReferencedDocumentHandles,
  removeNoteIfUnreferenced,
  replacePaneReferenceWithFreshDraft
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
    initialNote.handle
  );
  createReadyPaneForTest(
    workspace,
    secondary,
    initialNote.handle
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
    expect(listReferencedDocumentHandles(workspace)).toEqual([
      initialNote.handle
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

  it('keeps both pane references on the same handle after first save', () => {
    const { state, workspace, initialNote } = setupWorkspace();
    bindNotepadStateToVault(state, '/vault');
    const originalHandle = initialNote.handle;

    adoptCommittedDocument(state, initialNote, {
      noteId: 'saved-id',
      title: 'Saved',
      markdown: 'body',
      path: '/vault/Saved.md'
    });

    expect(workspace.getPaneState(primary).documentHandle).toBe(originalHandle);
    expect(workspace.getPaneState(secondary).documentHandle).toBe(originalHandle);
    expect(getPaneNote(state, workspace, primary)).toBe(initialNote);
    expect(getPaneNote(state, workspace, secondary)).toBe(initialNote);
  });

  it('closing one pane does not delete a still-referenced note', () => {
    const { state, workspace, initialNote } =
      setupWorkspace();
    const fresh = createFreshDraftNote(state);
    workspace.setPaneDocumentHandle(primary, fresh.handle);

    expect(
      getPaneNote(state, workspace, secondary)
    ).toBe(initialNote);
    expect(state.documentsByHandle[initialNote.handle]).toBe(
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
      initialNote.handle
    );

    expect(
      getPaneNote(state, workspace, primary)
    ).toBe(fresh);
    expect(
      getPaneNote(state, workspace, secondary)
    ).toBe(initialNote);
    expect(state.documentsByHandle[initialNote.handle]).toBe(
      initialNote
    );
  });

  it('removes the old document after a single-pane Remember rebind', () => {
    const initialNote = createNoteDraftState();
    const state = createNotepadState(initialNote);
    const workspace = new WorkspaceStore(
      primary,
      initialNote.handle
    );

    replacePaneReferenceWithFreshDraft(
      state,
      workspace,
      primary
    );
    removeNoteIfUnreferenced(
      state,
      workspace,
      initialNote.handle
    );

    expect(state.documentsByHandle[initialNote.handle]).toBeUndefined();
  });

  it('only removes a note after workspace references are gone', () => {
    const { state, workspace, initialNote } =
      setupWorkspace();

    removeNoteIfUnreferenced(
      state,
      workspace,
      initialNote.handle
    );
    expect(state.documentsByHandle[initialNote.handle]).toBe(
      initialNote
    );

    const fresh = createFreshDraftNote(state);
    workspace.setPaneDocumentHandle(primary, fresh.handle);
    workspace.setPaneDocumentHandle(secondary, fresh.handle);
    removeNoteIfUnreferenced(
      state,
      workspace,
      initialNote.handle
    );

    expect(state.documentsByHandle[initialNote.handle]).toBeUndefined();
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
    workspace.setPaneDocumentHandle(secondary, draft.handle);

    retirePaneForTest(workspace, secondary);

    expect(workspace.hasPane(secondary)).toBe(false);
    expect(state.documentsByHandle[draft.handle]).toBe(draft);
  });
});
