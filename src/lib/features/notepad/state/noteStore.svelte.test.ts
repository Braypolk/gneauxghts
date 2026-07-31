import { describe, expect, it } from 'vitest';
import {
  adoptSnapshotForPane,
  createFreshDraftNote,
  createNoteDraftState,
  upsertNote,
  type NoteKey,
  type PaneNoteReferences
} from './noteStore';
import { createReactiveNotepadState } from './noteStoreReactiveFixture.svelte';
import { createEmptySessionSnapshot } from '../session/session';

function references(initialKey: NoteKey) {
  let noteKey = initialKey;
  const value: PaneNoteReferences<'pane'> = {
    getPaneState: () => ({ noteKey }),
    setPaneNoteKey: (_paneId, nextKey) => {
      noteKey = nextKey;
    },
    replaceNoteKeyReferences: (previousKey, nextKey) => {
      if (noteKey === previousKey) noteKey = nextKey;
    },
    isNoteReferenced: (candidate) => candidate === noteKey,
    listReferencedNoteKeys: () => [noteKey]
  };
  return value;
}

describe('reactive note-store identity', () => {
  it('returns the canonical reactive object for inserted notes and drafts', () => {
    const initial = createNoteDraftState();
    const state = createReactiveNotepadState(initial);
    const inserted = createNoteDraftState();

    const stored = upsertNote(state, inserted);
    const fresh = createFreshDraftNote(state);

    expect(stored).toBe(state.notesByKey[inserted.key]);
    expect(fresh).toBe(state.notesByKey[fresh.key]);
  });

  it('returns the same object a pane reads after its first persisted-note adoption', () => {
    const initial = createNoteDraftState();
    const state = createReactiveNotepadState(initial);
    const paneReferences = references(initial.key);
    const snapshot = {
      ...createEmptySessionSnapshot(),
      title: 'Related',
      bodyMarkdown: 'new content',
      currentNoteId: 'related',
      currentNotePath: '/vault/Related.md',
      lastSavedTitle: 'Related',
      lastSavedMarkdown: 'new content',
      lastSavedNoteId: 'related',
      lastSavedPath: '/vault/Related.md'
    };

    const adopted = adoptSnapshotForPane(
      state,
      paneReferences,
      'pane',
      snapshot
    );

    expect(adopted).toBe(
      state.notesByKey[paneReferences.getPaneState('pane').noteKey]
    );
  });
});
