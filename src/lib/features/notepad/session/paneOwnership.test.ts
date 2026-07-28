import { describe, expect, it } from 'vitest';
import {
  addPane,
  adoptSnapshotForPane,
  createFreshDraftNote,
  createNoteDraftState,
  createNotepadState,
  getPaneNote,
  listReferencedNoteKeys,
  noteKeyFromPath,
  rekeyNote,
  removePane,
  removeNoteIfUnreferenced,
  setPaneNoteKey,
  type NoteDraftState,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';

// ---------------------------------------------------------------------------
// Shared note identity
// ---------------------------------------------------------------------------
describe('shared note identity', () => {
  it('two panes can reference the same note key', () => {
    const state = createNotepadState('primary' as never, ['primary', 'secondary'] as never);
    const sharedNote = getPaneNote(state, 'primary' as never);

    // Point secondary pane at the same note key
    setPaneNoteKey(state, 'secondary' as never, sharedNote.key);

    expect(getPaneNote(state, 'primary' as never)).toBe(sharedNote);
    expect(getPaneNote(state, 'secondary' as never)).toBe(sharedNote);
    expect(listReferencedNoteKeys(state)).toHaveLength(1);
  });

  it('edits in one pane update the shared note content visible to siblings', () => {
    const state = createNotepadState('primary' as never, ['primary', 'secondary'] as never);
    const sharedNote = getPaneNote(state, 'primary' as never);
    setPaneNoteKey(state, 'secondary' as never, sharedNote.key);

    // Edit via primary pane reference
    sharedNote.bodyMarkdown = 'edited content';
    sharedNote.operationRevision += 1;

    // Secondary pane sees the same object
    expect(getPaneNote(state, 'secondary' as never).bodyMarkdown).toBe('edited content');
  });

  it('closing one pane does not delete a still-referenced note', () => {
    const state = createNotepadState('primary' as never, ['primary', 'secondary'] as never);
    const sharedNote = getPaneNote(state, 'primary' as never);
    setPaneNoteKey(state, 'secondary' as never, sharedNote.key);

    // Reassign primary to a fresh draft
    const fresh = createFreshDraftNote(state);
    setPaneNoteKey(state, 'primary' as never, fresh.key);

    // Secondary still references sharedNote
    expect(getPaneNote(state, 'secondary' as never)).toBe(sharedNote);
    // sharedNote is still in notesByKey because secondary references it
    expect(state.notesByKey[sharedNote.key]).toBe(sharedNote);
  });

  it('removeNoteIfUnreferenced keeps notes still referenced by any pane', () => {
    const state = createNotepadState('primary' as never, ['primary', 'secondary'] as never);
    const sharedNote = getPaneNote(state, 'primary' as never);
    setPaneNoteKey(state, 'secondary' as never, sharedNote.key);

    removeNoteIfUnreferenced(state, sharedNote.key);
    expect(state.notesByKey[sharedNote.key]).toBe(sharedNote);

    // Now reassign both panes
    const fresh = createFreshDraftNote(state);
    setPaneNoteKey(state, 'primary' as never, fresh.key);
    setPaneNoteKey(state, 'secondary' as never, fresh.key);

    removeNoteIfUnreferenced(state, sharedNote.key);
    expect(state.notesByKey[sharedNote.key]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rekey transfer
// ---------------------------------------------------------------------------
describe('rekey transfer', () => {
  it('rekeying a note updates all pane references', () => {
    const state = createNotepadState('primary' as never, ['primary', 'secondary'] as never);
    const sharedNote = getPaneNote(state, 'primary' as never);
    const oldKey = sharedNote.key;
    setPaneNoteKey(state, 'secondary' as never, oldKey);

    const nextKey = noteKeyFromPath('/vault/Rekeyed.md') ?? (`path:/vault/Rekeyed.md` as NoteKey);
    const rekeyed = rekeyNote(state, oldKey, nextKey);

    expect(rekeyed).toBe(sharedNote);
    expect(rekeyed!.key).toBe(nextKey);
    // Both panes should now reference the new key
    const panesById = state.panesById as Record<string, { noteKey: NoteKey }>;
    expect(panesById['primary'].noteKey).toBe(nextKey);
    expect(panesById['secondary'].noteKey).toBe(nextKey);
    expect(state.notesByKey[oldKey]).toBeUndefined();
    expect(state.notesByKey[nextKey]).toBe(sharedNote);
  });

});

// ---------------------------------------------------------------------------
// noteStore state invariants
// ---------------------------------------------------------------------------
describe('noteStore invariants', () => {
  it('adoptSnapshotForPane preserves existing note when path matches', () => {
    const state = createNotepadState('primary' as never, ['primary', 'secondary'] as never);
    const originalNote = getPaneNote(state, 'primary' as never);

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

    const adopted = adoptSnapshotForPane(state, 'primary' as never, snapshot);
    expect(adopted.title).toBe('Updated Title');
    expect(adopted.bodyMarkdown).toBe('updated body');
    expect(getPaneNote(state, 'primary' as never)).toBe(adopted);
  });

  it('listReferencedNoteKeys deduplicates when both panes show the same note', () => {
    const state = createNotepadState('primary' as never, ['primary', 'secondary'] as never);
    const sharedNote = getPaneNote(state, 'primary' as never);
    setPaneNoteKey(state, 'secondary' as never, sharedNote.key);

    const keys = listReferencedNoteKeys(state);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(sharedNote.key);
  });

  it('dynamic pane removal drops pane state without deleting the note draft', () => {
    const state = createNotepadState<string>('pane-1', ['pane-1']);
    const draft = createFreshDraftNote(state);

    addPane(state, 'pane-2', draft.key, 'editor');
    expect(getPaneNote(state, 'pane-2')).toBe(draft);

    removePane(state, 'pane-2');

    expect(state.panesById['pane-2']).toBeUndefined();
    expect(state.notesByKey[draft.key]).toBe(draft);
  });
});
