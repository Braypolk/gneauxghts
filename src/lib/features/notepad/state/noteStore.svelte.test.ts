import { describe, expect, it } from 'vitest';
import {
  adoptCommittedDocument,
  adoptSnapshotForPane,
  bindNotepadStateToVault,
  createFreshDraftNote,
  createNoteDraftState,
  createNotepadState,
  findOpenDocument,
  removeNoteIfUnreferenced,
  upsertNote,
  type DocumentHandle,
  type PaneDocumentReferences
} from './noteStore';
import { createReactiveNotepadState } from './noteStoreReactiveFixture.svelte';
import { createEmptySessionSnapshot } from '../session/session';
import { updateDocumentMarkdown } from '../document/documentState';

function references(initialHandle: DocumentHandle) {
  let documentHandle = initialHandle;
  const value: PaneDocumentReferences<'pane'> = {
    getPaneState: () => ({ documentHandle }),
    setPaneDocumentHandle: (_paneId, nextHandle) => {
      documentHandle = nextHandle;
    },
    replaceDocumentHandleReferences: (previousHandle, nextHandle) => {
      if (documentHandle === previousHandle) documentHandle = nextHandle;
    },
    isDocumentReferenced: (candidate) => candidate === documentHandle,
    listReferencedDocumentHandles: () => [documentHandle]
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

    expect(stored).toBe(state.documentsByHandle[inserted.handle]);
    expect(fresh).toBe(state.documentsByHandle[fresh.handle]);
  });

  it('returns the same object a pane reads after its first persisted-note adoption', () => {
    const initial = createNoteDraftState();
    const state = createReactiveNotepadState(initial);
    const paneReferences = references(initial.handle);
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
      state.documentsByHandle[paneReferences.getPaneState('pane').documentHandle]
    );
  });
});

describe('stable open-document handles', () => {
  it('keeps the document object and handle while committed identity changes', () => {
    const draft = createNoteDraftState();
    const state = createNotepadState(draft);
    bindNotepadStateToVault(state, '/vault');
    const originalHandle = draft.handle;

    const outcome = adoptCommittedDocument(state, draft, {
      noteId: 'note-id',
      title: 'Saved',
      markdown: 'body',
      path: '/vault/Saved.md'
    });

    expect(outcome).toEqual({ kind: 'adopted', document: draft });
    expect(draft.handle).toBe(originalHandle);
    expect(state.documentsByHandle[originalHandle]).toBe(draft);
    expect(findOpenDocument(state, {
      vaultRoot: '/vault',
      noteId: 'note-id',
      path: '/vault/Saved.md'
    })).toBe(draft);
  });

  it('deduplicates an open request before constructing another document', () => {
    const snapshot = {
      ...createEmptySessionSnapshot(),
      title: 'Shared',
      bodyMarkdown: 'body',
      currentNoteId: 'shared-id',
      currentNotePath: '/vault/Shared.md',
      lastSavedTitle: 'Shared',
      lastSavedMarkdown: 'body',
      lastSavedNoteId: 'shared-id',
      lastSavedPath: '/vault/Shared.md'
    };
    const opened = createNoteDraftState(snapshot);
    const state = createNotepadState(opened);
    bindNotepadStateToVault(state, '/vault');
    const paneReferences = references(opened.handle);

    const adopted = adoptSnapshotForPane(
      state,
      paneReferences,
      'pane',
      snapshot
    );

    expect(adopted).toBe(opened);
    expect(Object.values(state.documentsByHandle)).toEqual([opened]);
  });

  it('retains both dirty documents and surfaces a post-commit canonical collision', () => {
    const existing = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Existing',
      bodyMarkdown: 'disk baseline',
      currentNoteId: 'target-id',
      currentNotePath: '/vault/Target.md',
      lastSavedTitle: 'Existing',
      lastSavedMarkdown: 'disk baseline',
      lastSavedNoteId: 'target-id',
      lastSavedPath: '/vault/Target.md'
    });
    const state = createNotepadState(existing);
    bindNotepadStateToVault(state, '/vault');
    updateDocumentMarkdown(existing, 'existing dirty draft');
    const savingDraft = createFreshDraftNote(state);
    updateDocumentMarkdown(savingDraft, 'independent dirty draft');

    const outcome = adoptCommittedDocument(state, savingDraft, {
      noteId: 'target-id',
      title: 'Target',
      markdown: 'independent dirty draft',
      path: '/vault/Target.md'
    }, { preserveWorking: true });

    expect(outcome).toMatchObject({
      kind: 'collision',
      document: savingDraft,
      conflictingDocument: existing
    });
    expect(Object.values(state.documentsByHandle)).toEqual(
      expect.arrayContaining([existing, savingDraft])
    );
    expect(existing.canonicalCollision?.otherHandle).toBe(savingDraft.handle);
    expect(savingDraft.canonicalCollision?.otherHandle).toBe(existing.handle);
    expect(findOpenDocument(state, {
      vaultRoot: '/vault',
      noteId: 'target-id',
      path: '/vault/Target.md'
    })).toBe(existing);

    const survivingReferences: PaneDocumentReferences<'pane'> = {
      getPaneState: () => ({ documentHandle: savingDraft.handle }),
      setPaneDocumentHandle: () => undefined,
      replaceDocumentHandleReferences: () => undefined,
      isDocumentReferenced: (handle) => handle === savingDraft.handle,
      listReferencedDocumentHandles: () => [savingDraft.handle]
    };
    removeNoteIfUnreferenced(
      state,
      survivingReferences,
      existing.handle
    );

    expect(findOpenDocument(state, {
      vaultRoot: '/vault',
      noteId: 'target-id',
      path: '/vault/Target.md'
    })).toBe(savingDraft);
    expect(savingDraft.canonicalCollision).toBeNull();
  });

  it('keeps a collision reciprocal when the established document moves under the same identity', () => {
    const established = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Established',
      bodyMarkdown: 'disk baseline',
      currentNoteId: 'shared-id',
      currentNotePath: '/vault/Before.md',
      lastSavedTitle: 'Established',
      lastSavedMarkdown: 'disk baseline',
      lastSavedNoteId: 'shared-id',
      lastSavedPath: '/vault/Before.md'
    });
    const state = createNotepadState(established, '/vault');
    updateDocumentMarkdown(established, 'established dirty draft');
    const collided = createFreshDraftNote(state);
    updateDocumentMarkdown(collided, 'independent dirty draft');
    adoptCommittedDocument(state, collided, {
      noteId: 'shared-id',
      title: 'Before',
      markdown: 'independent dirty draft',
      path: '/vault/Before.md'
    }, { preserveWorking: true });

    const outcome = adoptCommittedDocument(state, established, {
      noteId: 'shared-id',
      title: 'After',
      markdown: 'moved disk baseline',
      path: '/vault/After.md'
    }, { preserveWorking: true });

    expect(outcome).toMatchObject({
      kind: 'collision',
      document: established,
      conflictingDocument: collided
    });
    expect(established.canonicalCollision?.otherHandle).toBe(collided.handle);
    expect(collided.canonicalCollision?.otherHandle).toBe(established.handle);
    expect(findOpenDocument(state, {
      noteId: 'shared-id',
      path: '/vault/After.md'
    })).toBe(established);
    expect(findOpenDocument(state, {
      noteId: null,
      path: '/vault/Before.md'
    })).toBe(established);
  });

  it('separately indexes both documents when the established collision participant adopts a distinct identity', () => {
    const established = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Established',
      bodyMarkdown: 'disk baseline',
      currentNoteId: 'shared-id',
      currentNotePath: '/vault/Shared.md',
      lastSavedTitle: 'Established',
      lastSavedMarkdown: 'disk baseline',
      lastSavedNoteId: 'shared-id',
      lastSavedPath: '/vault/Shared.md'
    });
    const state = createNotepadState(established, '/vault');
    updateDocumentMarkdown(established, 'established dirty draft');
    const collided = createFreshDraftNote(state);
    updateDocumentMarkdown(collided, 'independent dirty draft');
    adoptCommittedDocument(state, collided, {
      noteId: 'shared-id',
      title: 'Shared',
      markdown: 'independent dirty draft',
      path: '/vault/Shared.md'
    }, { preserveWorking: true });

    const outcome = adoptCommittedDocument(state, established, {
      noteId: 'distinct-id',
      title: 'Distinct',
      markdown: 'distinct disk baseline',
      path: '/vault/Distinct.md'
    }, { preserveWorking: true });

    expect(outcome).toEqual({ kind: 'adopted', document: established });
    expect(established.canonicalCollision).toBeNull();
    expect(collided.canonicalCollision).toBeNull();
    expect(findOpenDocument(state, {
      noteId: 'distinct-id',
      path: '/vault/Distinct.md'
    })).toBe(established);
    expect(findOpenDocument(state, {
      noteId: 'shared-id',
      path: '/vault/Shared.md'
    })).toBe(collided);
  });

  it('preserves each unique identity alias during a path-only collision', () => {
    const established = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Established',
      bodyMarkdown: 'established draft',
      currentNoteId: 'established-id',
      currentNotePath: '/vault/Shared.md',
      lastSavedTitle: 'Established',
      lastSavedMarkdown: 'established baseline',
      lastSavedNoteId: 'established-id',
      lastSavedPath: '/vault/Shared.md'
    });
    const state = createNotepadState(established, '/vault');
    const collided = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Collided',
      bodyMarkdown: 'independent draft',
      currentNoteId: 'collided-id',
      currentNotePath: '/vault/Shared.md',
      lastSavedTitle: 'Collided',
      lastSavedMarkdown: 'collided baseline',
      lastSavedNoteId: 'collided-id',
      lastSavedPath: '/vault/Shared.md'
    });

    upsertNote(state, collided);

    expect(established.canonicalCollision?.otherHandle).toBe(collided.handle);
    expect(collided.canonicalCollision?.otherHandle).toBe(established.handle);
    expect(findOpenDocument(state, {
      noteId: null,
      path: '/vault/Shared.md'
    })).toBe(established);
    expect(findOpenDocument(state, {
      noteId: 'established-id',
      path: null
    })).toBe(established);
    expect(findOpenDocument(state, {
      noteId: 'collided-id',
      path: null
    })).toBe(collided);
  });

  it('does not resolve identical durable identities across vault contexts', () => {
    const documentA = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      currentNoteId: 'same-id',
      currentNotePath: '/vault-a/Same.md',
      lastSavedNoteId: 'same-id',
      lastSavedPath: '/vault-a/Same.md'
    });
    const documentB = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      currentNoteId: 'same-id',
      currentNotePath: '/vault-b/Same.md',
      lastSavedNoteId: 'same-id',
      lastSavedPath: '/vault-b/Same.md'
    });
    const stateA = createNotepadState(documentA);
    const stateB = createNotepadState(documentB);
    bindNotepadStateToVault(stateA, '/vault-a');
    bindNotepadStateToVault(stateB, '/vault-b');

    expect(findOpenDocument(stateA, {
      vaultRoot: '/vault-a',
      noteId: 'same-id',
      path: '/vault-a/Same.md'
    })).toBe(documentA);
    expect(findOpenDocument(stateB, {
      vaultRoot: '/vault-b',
      noteId: 'same-id',
      path: '/vault-b/Same.md'
    })).toBe(documentB);
    expect(findOpenDocument(stateA, {
      vaultRoot: '/vault-b',
      noteId: 'same-id',
      path: '/vault-b/Same.md'
    })).toBeNull();
    expect(findOpenDocument(stateB, {
      vaultRoot: '/vault-a',
      noteId: 'same-id',
      path: '/vault-a/Same.md'
    })).toBeNull();
  });

  it('moves the canonical path lookup without replacing the open document', () => {
    const document = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Before move',
      bodyMarkdown: 'body',
      currentNoteId: 'move-id',
      currentNotePath: '/vault/Before.md',
      lastSavedTitle: 'Before move',
      lastSavedMarkdown: 'body',
      lastSavedNoteId: 'move-id',
      lastSavedPath: '/vault/Before.md'
    });
    const state = createNotepadState(document, '/vault');
    const handle = document.handle;

    adoptCommittedDocument(state, document, {
      noteId: 'move-id',
      title: 'After move',
      markdown: 'body',
      path: '/vault/After.md'
    });

    expect(document.handle).toBe(handle);
    expect(findOpenDocument(state, {
      noteId: null,
      path: '/vault/Before.md'
    })).toBeNull();
    expect(findOpenDocument(state, {
      noteId: 'move-id',
      path: '/vault/After.md'
    })).toBe(document);
  });
});
