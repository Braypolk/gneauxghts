import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import type {
  CommitNoteReviewResult,
  ProposalPreview
} from '$lib/types/proposals';
import { createReviewEditorForTest as fakeEditor } from './proposalEditorTestSupport';
import { createProposalReviewSession } from './reviewSession.svelte';
import { createProposalOrchestration } from './proposalOrchestration';
import { documentHasCleanBuffer, updateDocumentMarkdown, updateDocumentTitle } from '$lib/features/notepad/document/documentState';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { createNotepadPersistenceController } from '$lib/features/notepad/orchestration/persistenceController';
import { createWorkspacePersistenceService } from '$lib/features/notepad/workspace/workspacePersistenceService';
import { captureExternalSnapshotForTest } from '$lib/features/notepad/document/documentExternalSyncTestSupport';
import type { DurableProposalReviewRequest } from './types';

const path = '/vault/Plan.md';
const preview: ProposalPreview = {
  reviewId: 'review-1',
  notePath: path,
  title: 'Plan',
  baseContentHash: 'hash-1',
  baseEditorMarkdown: 'Before',
  proposedEditorMarkdown: 'After',
  hunks: [
    {
      id: 'hunk-1',
      baseFrom: 0,
      baseTo: 6,
      proposedFrom: 0,
      proposedTo: 5,
      oldText: 'Before',
      newText: 'After'
    }
  ]
};

function note() {
  return createNoteDraftState({
    ...createEmptySessionSnapshot(),
    title: 'Plan',
    bodyMarkdown: 'Before',
    currentNoteId: 'note-1',
    currentNotePath: path,
    lastSavedNoteId: 'note-1',
    lastSavedTitle: 'Plan',
    lastSavedMarkdown: 'Before',
    lastSavedPath: path
  });
}


function setup(options: { opened?: boolean; sibling?: boolean } = {}) {
  const document = note();
  const firstEditor = fakeEditor(document);
  const siblingEditor = options.sibling ? fakeEditor(document) : null;
  const session = createProposalReviewSession();
  let opened = options.opened ?? false;
  let currentEditor = firstEditor;
  // Mirrors the real adapter, which resolves an editor only from panes that
  // currently display the requested document.
  let editorDocument: ReturnType<typeof note> | null = document;
  const commit = vi.fn<() => Promise<CommitNoteReviewResult>>(
    async () => ({
      status: 'committed',
      committedMarkdown: 'After',
      applied: {
        kind: 'updateNote',
        path,
        previousPath: path
      },
      noteId: 'note-1',
      message: null
    })
  );
  const dismiss = vi.fn<() => Promise<void>>(async () => undefined);
  const acknowledgeDocumentCommit = vi.fn(async () => undefined);
  const presentReviewDocument = vi.fn(async () => {
    opened = true;
    return document;
  });
  const reloadReviewDocument = vi.fn(async () => undefined);
  const finishReviewDocument = vi.fn(async (_document: ReturnType<typeof note>) => {});
  const orchestration = createProposalOrchestration({
    getEditorPaneDocument: (requestedPath) =>
      opened && requestedPath === path ? document : null,
    getEditorForDocument: (requested) =>
      requested === editorDocument ? currentEditor.adapter : null,
    onReviewMarkdownChange: updateDocumentMarkdown,
    finishReviewDocument,
    presentReviewDocument,
    reloadReviewDocument,
    acknowledgeDocumentCommit,
    session
  });

  return {
    document,
    firstEditor,
    siblingEditor,
    session,
    commit,
    dismiss,
    acknowledgeDocumentCommit,
    finishReviewDocument,
    presentReviewDocument,
    reloadReviewDocument,
    orchestration,
    setCurrentEditor: (editor: ReturnType<typeof fakeEditor>) => {
      currentEditor = editor;
    },
    /** Rebinds the editor pane to another document, or to none. */
    setEditorDocument: (next: ReturnType<typeof note> | null) => {
      editorDocument = next;
    },
    request: {
      proposalId: 'proposal-1',
      noteId: 'note-1',
      preview,
      commit,
      dismiss
    }
  };
}

afterEach(() => {
  for (const runtime of [...documentRegistry.values()]) {
    const editor = runtime.resources()?.runtime;
    if (editor?.review) editor.endReview(editor.review.reviewId);
    documentRegistry.dispose(runtime.documentHandle);
  }
});

describe('durable proposal editor review', () => {
  it('reviews a new note in a draft document, checkpoints edits and discards without autosave', async () => {
    const document = createNoteDraftState(createEmptySessionSnapshot());
    const editor = fakeEditor(document);
    const session = createProposalReviewSession();
    const checkpoint = vi.fn(async () => undefined);
    const finish = vi.fn(async () => { expect(documentHasCleanBuffer(document)).toBe(true); });
    const dismiss = vi.fn(async () => undefined);
    const commit = vi.fn();
    const orchestration = createProposalOrchestration({
      getEditorPaneDocument: () => null,
      getEditorForDocument: () => editor.adapter,
      presentReviewDocument: async () => document,
      onReviewMarkdownChange: updateDocumentMarkdown,
      finishReviewDocument: finish,
      acknowledgeDocumentCommit: vi.fn(), reloadReviewDocument: vi.fn(), session
    });
    const creation = { ...preview, baseEditorMarkdown: '', proposedEditorMarkdown: 'Draft',
      hunks: [{ ...preview.hunks[0], baseTo: 0, oldText: '', newText: 'Draft' }] };
    expect(await orchestration.loadDurableProposal({ proposalId: 'new', noteId: null,
      kind: 'create', preview: creation, checkpoint, commit, dismiss })).toBe(true);
    expect(document.working.title).toBe('Plan');
    editor.runtime.replaceMarkdown('My edited draft');
    await orchestration.flushCheckpoint();
    expect(checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: 'My edited draft', title: 'Plan' }));
    await orchestration.undoAll();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
    orchestration.dispose();
  });

  it('allows workspace flush with an unaccepted review and remounts it without saving', async () => {
      const test = setup();
      await test.orchestration.loadDurableProposal(test.request);
      const saveNoteSession = vi.fn();
      const persistence = createNotepadPersistenceController({
        getDocumentSession: () => test.document,
        saveNoteSession,
        documentEditing: { captureSave: vi.fn(), adoptSavedResult: vi.fn() },
        shouldSuppressPersistence: test.session.isReviewingDocument
      });
      const workspace = createWorkspacePersistenceService({
        getDocuments: () => [test.document],
        flushAllPaneCursorSaves: vi.fn(),
        ...persistence,
        isReviewingDocument: test.session.isReviewingDocument
      });
      const leave = () => workspace.flushAllForNavigation();

      try {
        await leave();
        test.firstEditor.dispose();
        const remounted = fakeEditor(test.document);
        test.setCurrentEditor(remounted);

        expect(remounted.markdown).toBe('After');
        expect(remounted.review?.hunks[0].status).toBe('pending');
        expect(test.document.savedBaseline?.content.markdown).toBe('Before');
        expect(documentHasCleanBuffer(test.document)).toBe(false);
        expect(saveNoteSession).not.toHaveBeenCalled();
        expect(test.commit).not.toHaveBeenCalled();
        expect(test.dismiss).not.toHaveBeenCalled();

        // A review must not exempt an actual external-change conflict.
        captureExternalSnapshotForTest(test.document, {
          ...createEmptySessionSnapshot(),
          bodyMarkdown: 'Changed outside the app'
        }, 'watcher');
        await expect(leave()).rejects.toThrow();
        expect(saveNoteSession).not.toHaveBeenCalled();
      } finally {
        documentRegistry.dispose(test.document.handle);
      }
  });

  it('opens the target note and installs the proposed body and live hunks', async () => {
    const test = setup();

    await expect(
      test.orchestration.loadDurableProposal(test.request)
    ).resolves.toBe(true);

    expect(test.firstEditor.markdown).toBe('After');
    expect(test.firstEditor.installed).toBe(true);
    expect(test.session.isReviewingDocument(test.document)).toBe(true);
    expect(test.session.snapshot).toMatchObject({
      proposalId: 'proposal-1',
      notePath: path,
      title: 'Plan',
      totalHunks: 1,
      unresolvedHunks: 1,
      isApplying: false,
      isConflicted: false,
      error: null
    });
    expect(test.orchestration.isReviewingProposal('proposal-1')).toBe(true);
  });


  it('resolves its retained document while another note is visible', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.firstEditor.dispose();
    const unrelated = note();
    updateDocumentMarkdown(unrelated, 'Unrelated note body');
    const other = fakeEditor(unrelated);
    test.setCurrentEditor(other);
    test.setEditorDocument(unrelated);
    await test.orchestration.keepAll();
    expect(test.commit).toHaveBeenCalledExactlyOnceWith('After');
    expect(other.markdown).toBe('Unrelated note body');
    expect(unrelated.working.markdown).toBe('Unrelated note body');
  });

  it('reactivates a remounted editor before focusing the next hunk', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.firstEditor.dispose();

    const remounted = fakeEditor(test.document);
    const focus = vi.spyOn(remounted.adapter, 'focusSelection');
    test.setCurrentEditor(remounted);

    await test.orchestration.reviewNext();

    expect(remounted.markdown).toBe('After');
    expect(remounted.installed).toBe(true);
    expect(focus).toHaveBeenCalledWith({ anchor: 0, head: 5 });
    expect(test.session.snapshot.error).toBeNull();
  });

  it('replaces an earlier same-target preview when the run stages a newer one', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    const latestPreview: ProposalPreview = {
      ...preview,
      reviewId: 'review-2',
      proposedEditorMarkdown: 'Latest',
      hunks: [
        {
          ...preview.hunks[0],
          id: 'hunk-2',
          proposedTo: 6,
          newText: 'Latest'
        }
      ]
    };

    await test.orchestration.loadDurableProposal({
      ...test.request,
      proposalId: 'proposal-2',
      preview: latestPreview
    });

    expect(test.firstEditor.markdown).toBe('Latest');
    expect(test.orchestration.activeProposalId).toBe('proposal-2');
    expect(test.firstEditor.review).toMatchObject({ reviewId: 'review-2', hunks: [{ id: 'hunk-2', status: 'pending' }] });
    expect(test.commit).not.toHaveBeenCalled();
    expect(test.dismiss).not.toHaveBeenCalled();
    await test.orchestration.keepAll();
    expect(test.commit).toHaveBeenCalledExactlyOnceWith('Latest');
  });

  it.each(['same', 'other'])('preserves user edits when a %s-target proposal tries to replace the review', async target => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.firstEditor.view.dispatch({ changes: { from: 5, insert: '\noutside' } });
    expect(await test.orchestration.loadDurableProposal({
      ...test.request, proposalId: 'replacement',
      preview: { ...preview, reviewId: 'replacement', notePath: target === 'same' ? path : '/other.md' }
    })).toBe(false);
    expect(test.firstEditor.runtime.markdown).toBe('After\noutside');
    expect(test.document.working.markdown).toBe('After\noutside');
    expect(test.orchestration.activeProposalId).toBe('proposal-1');
    expect(test.finishReviewDocument).not.toHaveBeenCalled();
  });

  it('releases the previous closed document when replacement admission fails', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.firstEditor.dispose();
    test.setEditorDocument(null);
    test.finishReviewDocument.mockImplementation(async document => documentRegistry.dispose(document.handle));
    expect(await test.orchestration.loadDurableProposal({
      ...test.request, proposalId: 'other',
      preview: { ...preview, reviewId: 'other', notePath: '/vault/other.md' }
    })).toBe(false);
    expect(test.finishReviewDocument).toHaveBeenCalledExactlyOnceWith(test.document);
    expect(documentRegistry.get(test.document.handle)).toBeNull();
    expect(test.session.snapshot.proposalId).toBeNull();
  });

  it('releases a failed start without replacing the mismatched root text', async () => {
    const test = setup();
    test.firstEditor.runtime.replaceMarkdown('changed', { notifyMarkdownChange: false });
    expect(await test.orchestration.loadDurableProposal(test.request)).toBe(false);
    expect(test.firstEditor.runtime.markdown).toBe('changed');
    expect(test.finishReviewDocument).toHaveBeenCalledExactlyOnceWith(test.document);
    expect(test.session.snapshot.proposalId).toBeNull();
  });

  it('retires an unfinished route opening without stranding global admission', async () => {
    const test = setup();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    test.presentReviewDocument.mockImplementationOnce(async () => {
      entered();
      await waiting;
      return test.document;
    });
    const opening = test.orchestration.loadDurableProposal(test.request);
    await started;
    test.orchestration.dispose();
    expect(test.session.workflow.kind).toBe('idle');
    release();
    expect(await opening).toBe(false);
    expect(test.firstEditor.runtime.review).toBeNull();
    expect(test.firstEditor.markdown).toBe('Before');
  });

  it('retires route admission while an accepted durable commit settles its retained document', async () => {
    const test = setup();
    let finish!: (result: CommitNoteReviewResult) => void;
    test.commit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await test.orchestration.loadDurableProposal(test.request);
    const pending = test.orchestration.keepAll();
    test.orchestration.dispose();
    expect(documentRegistry.isReviewing(test.document.handle)).toBe(true);
    expect(test.session.workflow.kind).toBe('committing');
    documentRegistry.dispose(test.document.handle);
    expect(documentRegistry.get(test.document.handle)).not.toBeNull();
    finish({ status: 'committed', committedMarkdown: 'After', applied: { kind: 'updateNote', path, previousPath: path }, noteId: 'note-1', message: null });
    await pending;
    expect(test.acknowledgeDocumentCommit).toHaveBeenCalledOnce();
    expect(test.session.workflow.kind).toBe('idle');
    expect(documentRegistry.isReviewing(test.document.handle)).toBe(false);
    expect(await test.orchestration.loadDurableProposal(test.request)).toBe(false);
  });

  it.each(['explicit', 'passive'])('preserves an unsaved title during %s review admission', async mode => {
    const test = setup({ opened: true });
    updateDocumentTitle(test.document, 'My unsaved title');
    const request = { ...test.request, checkpoint: async () => undefined,
      working: { markdown: 'After', title: 'Persisted title', path, decisions: [] } };
    const opened = mode === 'passive'
      ? await test.orchestration.loadDurableProposalIfOpen(request)
      : await test.orchestration.loadDurableProposal(request);
    expect(opened).toBe(false);
    expect(test.document.working.title).toBe('My unsaved title');
    expect(test.firstEditor.markdown).toBe('Before');
    expect(test.firstEditor.review).toBeNull();
  });

  it('coalesces edits behind a location write without reapplying its old filename', async () => {
    const test = setup();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const checkpoint = vi.fn(async () => { if (checkpoint.mock.calls.length === 1) await blocked; });
    await test.orchestration.loadDurableProposal({ ...test.request, kind: 'create', checkpoint });
    const location = test.session.snapshot.changeLocation;
    const moved = location!('/vault/Moved.md');
    await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledOnce());
    updateDocumentTitle(test.document, 'Newest title');
    for (const text of ['First edit', 'Second edit', 'Newest edit']) test.firstEditor.runtime.replaceMarkdown(text);
    const flushed = test.orchestration.flushCheckpoint();
    release();
    await Promise.all([moved, flushed]);
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: 'Newest edit', title: 'Newest title', requestedPath: undefined }));
  });

  it('retains an undispatched location when newer body edits coalesce with it', async () => {
    const test = setup();
    const checkpoint = vi.fn(async () => undefined);
    await test.orchestration.loadDurableProposal({ ...test.request, kind: 'create', checkpoint });
    const moved = test.session.snapshot.changeLocation!('/vault/Moved.md');
    test.firstEditor.runtime.replaceMarkdown('Newest body');
    await Promise.all([moved, test.orchestration.flushCheckpoint()]);
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: 'Newest body', requestedPath: '/vault/Moved.md' }));
  });

  it('reports a failed location even when a newer body checkpoint succeeds', async () => {
    const test = setup();
    let rejectLocation!: (error: Error) => void;
    const blocked = new Promise<void>((_resolve, reject) => { rejectLocation = reject; });
    const checkpoint = vi.fn(async () => { if (checkpoint.mock.calls.length === 1) await blocked; });
    await test.orchestration.loadDurableProposal({ ...test.request, kind: 'create', checkpoint });
    const moved = test.session.snapshot.changeLocation!('/vault/Moved.md');
    const rejectedMove = expect(moved).rejects.toThrow('location unavailable');
    await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledOnce());
    test.firstEditor.runtime.replaceMarkdown('Newest body');
    const rejectedFlush = expect(test.orchestration.flushCheckpoint()).rejects.toThrow('location unavailable');
    rejectLocation(new Error('location unavailable'));
    await Promise.all([rejectedMove, rejectedFlush]);
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: 'Newest body', requestedPath: undefined }));
  });

  it('keeps ordinary edits outside a legacy proposal when all hunks are undone', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.firstEditor.view.dispatch({ changes: { from: 5, insert: '\nOrdinary addition' } });
    await test.orchestration.undoAll();
    expect(test.dismiss).toHaveBeenCalledOnce();
    expect(test.firstEditor.markdown).toBe('Before\nOrdinary addition');
    expect(test.finishReviewDocument).toHaveBeenCalledOnce();
  });

  it('reopens an older durable draft over a clean newer destination without writing the older base on discard', async () => {
    const test = setup();
    const newer = { ...preview, baseEditorMarkdown: 'Before', proposedEditorMarkdown: 'After' };
    test.firstEditor.runtime.replaceMarkdown('Before');
    const old = { ...newer, baseEditorMarkdown: 'Old base' };
    await expect(test.orchestration.loadDurableProposal({ ...test.request, preview: old,
      checkpoint: async () => undefined,
      working: { markdown: 'My retained addition', title: 'Plan', path, decisions: [] } })).resolves.toBe(true);
    expect(test.firstEditor.markdown).toBe('My retained addition');
    await test.orchestration.discard();
    expect(test.firstEditor.markdown).toBe('Before');
    expect(test.commit).not.toHaveBeenCalled();
  });

  it('retains the edited review and reports checkpoint failure when switching', async () => {
    const test = setup();
    const checkpoint = vi.fn(async () => { throw new Error('Draft storage unavailable'); });
    await test.orchestration.loadDurableProposal({ ...test.request, checkpoint });
    test.firstEditor.view.dispatch({ changes: { from: 0, to: 5, insert: 'My edited answer' } });
    const opened = await test.orchestration.loadDurableProposal({ ...test.request,
      proposalId: 'proposal-2', preview: { ...preview, reviewId: 'review-2' }, checkpoint });
    expect(opened).toBe(false);
    expect(test.orchestration.activeProposalId).toBe('proposal-1');
    expect(test.firstEditor.markdown).toBe('My edited answer');
    expect(test.firstEditor.review?.reviewId).toBe('review-1');
    expect(test.session.snapshot.error).toContain('Draft storage unavailable');
    expect(test.finishReviewDocument).not.toHaveBeenCalled();
  });

  it('checkpoints partial decisions before switching and restores them with the edited body', async () => {
    const test = setup();
    const checkpoint = vi.fn(async (_state: unknown) => undefined);
    const multi: ProposalPreview = { ...preview, proposedEditorMarkdown: 'After\nNew', hunks: [
      preview.hunks[0],
      { id: 'second', baseFrom: 6, baseTo: 6, proposedFrom: 5, proposedTo: 9, oldText: '', newText: '\nNew' }
    ] };
    await test.orchestration.loadDurableProposal({ ...test.request, preview: multi, checkpoint });
    test.firstEditor.runtime.resolveReview('review-1', ['hunk-1'], 'kept');
    test.firstEditor.view.dispatch({changes: {from: 6, to: 9, insert: 'My new detail'}});
    await test.orchestration.loadDurableProposal({ ...test.request, proposalId: 'proposal-2',
      preview: { ...preview, reviewId: 'review-2' }, checkpoint });
    const saved = checkpoint.mock.calls.at(-1)?.[0] as unknown as {
      markdown: string; title: string; decisions: import('$lib/types/proposals').ReviewHunkState[]
    };
    expect(saved.markdown).toBe('After\nMy new detail');
    expect(saved.decisions).toMatchObject([{status: 'kept'}, {status: 'modified'}]);
    await test.orchestration.loadDurableProposal({ ...test.request, preview: multi, checkpoint,
      working: {...saved, path}, draftVersion: 3 });
    expect(test.firstEditor.markdown).toBe(saved.markdown);
    expect(test.firstEditor.review?.hunks).toEqual(saved.decisions);
    expect(test.commit).not.toHaveBeenCalled();
  });

  it('recovers a commit conflict through the same review state', async () => {
    const test = setup();
    test.commit.mockResolvedValueOnce({
      status: 'conflict',
      committedMarkdown: null,
      applied: null,
      noteId: null,
      message: 'Changed on disk.'
    });
    await test.orchestration.loadDurableProposal(test.request);

    await test.orchestration.keepAll();
    expect(test.session.workflow.kind).toBe('conflicted');
    expect(test.session.snapshot.isApplying).toBe(false);
    expect(test.session.snapshot.error).toBe('Changed on disk.');

    await test.orchestration.retryCommit();
    expect(test.orchestration.activeProposalId).toBeNull();
    expect(test.commit).toHaveBeenCalledTimes(2);
  });

  it('adopts the refreshed preview identity on conflict and retains authored bytes for recovery', async () => {
    const test = setup(), authored = 'After\nHuman detail', base = 'Newer canonical';
    test.commit.mockResolvedValueOnce({ status:'conflict', committedMarkdown:null, applied:null, noteId:null, message:'Changed on disk.' });
    const checkpoint = vi.fn(async () => undefined);
    const refreshed = {...test.request, checkpoint, preview:{...preview, reviewId:'review-new-base', baseContentHash:'new-hash', baseEditorMarkdown:base,
      proposedEditorMarkdown:authored, hunks:[{...preview.hunks[0],id:'new-base-hunk',baseTo:base.length,oldText:base,proposedTo:authored.length,newText:authored}]},
      working:{title:'Plan',path,markdown:authored,decisions:[]}};
    const refresh = vi.fn(async () => refreshed);
    test.reloadReviewDocument.mockImplementationOnce(async () => {
      test.firstEditor.runtime.adoptCommittedMarkdown(base);
      updateDocumentTitle(test.document,'Canonical renamed title');
    });
    await test.orchestration.loadDurableProposal({...test.request, checkpoint, refresh});
    test.firstEditor.runtime.replaceMarkdown(authored);
    await test.orchestration.keepAll();
    expect(test.session.workflow).toMatchObject({kind:'conflicted',identity:{reviewId:'review-new-base',proposalId:'proposal-1',notePath:path},error:'Changed on disk.'});
    expect(test.session.snapshot).toMatchObject({isApplying:false,isConflicted:true,error:'Changed on disk.'});
    expect(test.firstEditor.review?.reviewId).toBe('review-new-base');
    expect(test.firstEditor.markdown).toBe(authored);
    expect(test.document.working.title).toBe(refreshed.working.title);
    expect(test.reloadReviewDocument).toHaveBeenCalledOnce();
    expect(test.acknowledgeDocumentCommit).not.toHaveBeenCalled();
    expect(test.session.dispatchWorkflow({type:'resolutionRequested',reviewId:'review-1',resolution:'commit'})).toBe(false);
    expect(test.session.snapshot.isApplying).toBe(false);
    await test.orchestration.keepAll();
    expect(test.commit).toHaveBeenCalledTimes(2);
    expect(test.commit).toHaveBeenLastCalledWith(authored);
    expect(test.orchestration.activeProposalId).toBeNull();
  });

  it('retains newer body, title and hunk choices typed while conflict refresh awaits', async () => {
    const test=setup(), waiting=Promise.withResolvers<void>(), refreshResult=Promise.withResolvers<DurableProposalReviewRequest>();
    const checkpoint=vi.fn(async()=>undefined);
    test.commit.mockResolvedValueOnce({status:'conflict',committedMarkdown:null,applied:null,noteId:null,message:'Changed on disk.'});
    test.reloadReviewDocument.mockImplementationOnce(async()=>{test.firstEditor.runtime.replaceMarkdown('Newer canonical');});
    const refresh=vi.fn(async()=>{waiting.resolve();return refreshResult.promise;});
    await test.orchestration.loadDurableProposal({...test.request,checkpoint,refresh});
    const completion=test.orchestration.keepAll();await waiting.promise;
    const newer='After\nTyped while refresh waited';
    test.firstEditor.runtime.replaceMarkdown(newer);updateDocumentTitle(test.document,'Newer human title');
    const decisions=test.firstEditor.review!.hunks.map(hunk=>({...hunk}));
    refreshResult.resolve({...test.request,preview:{...preview,reviewId:'refreshed-base',baseContentHash:'new-hash',baseEditorMarkdown:'Newer canonical'},
      working:{markdown:'After',title:'Plan',path,decisions:[]}});
    await completion;
    expect(test.firstEditor.markdown).toBe(newer);
    expect(test.document.working.title).toBe('Newer human title');
    expect(test.firstEditor.review!.hunks).toEqual(decisions);
    expect(test.firstEditor.review!.reviewId).toBe('review-1');
    expect(test.session.workflow).toMatchObject({kind:'conflicted',identity:{reviewId:'review-1'}});
    expect(test.session.snapshot).toMatchObject({isApplying:false,isConflicted:true});
    expect(test.session.snapshot.error).toContain('Newer edits are retained');
    expect(test.reloadReviewDocument).not.toHaveBeenCalled();
    expect(test.acknowledgeDocumentCommit).not.toHaveBeenCalled();
    expect(test.commit).toHaveBeenCalledExactlyOnceWith('After');
  });

  it('retains live body, title and hunk choices when typing invalidates a pending conflict reload', async () => {
    const test = setup(), entered = Promise.withResolvers<void>(), reload = Promise.withResolvers<void>();
    test.commit.mockResolvedValueOnce({status:'conflict',committedMarkdown:null,applied:null,noteId:null,message:'Changed on disk.'});
    const refresh = async () => ({...test.request, preview:{...preview,reviewId:'new-base',baseContentHash:'new-hash'}});
    test.reloadReviewDocument.mockImplementationOnce(async () => {
      const revision = test.document.operation.revision;
      entered.resolve(); await reload.promise;
      if (test.document.operation.revision !== revision) {
        throw new Error('The reviewed note changed while loading from disk. Try Reload Disk again.');
      }
    });
    await test.orchestration.loadDurableProposal({...test.request,refresh});
    const completion = test.orchestration.keepAll();
    await entered.promise;
    const newer = 'After\nTyped during disk reload';
    test.firstEditor.runtime.replaceMarkdown(newer);
    updateDocumentTitle(test.document,'Title typed during disk reload');
    const latestDecisions = test.firstEditor.review?.hunks.map(hunk => ({...hunk}));
    reload.resolve();
    await completion;
    expect(test.firstEditor.markdown).toBe(newer);
    expect(test.document.working.markdown).toBe(newer);
    expect(test.document.working.title).toBe('Title typed during disk reload');
    expect(latestDecisions).toEqual([expect.objectContaining({id:'hunk-1',status:'kept'})]);
    expect(test.firstEditor.review).toMatchObject({reviewId:'review-1',hunks:latestDecisions});
    expect(test.session.workflow).toMatchObject({kind:'conflicted',identity:{reviewId:'review-1'}});
    expect(test.session.snapshot).toMatchObject({isApplying:false,isConflicted:true});
    expect(test.session.snapshot.error).toContain('changed while loading from disk');
    expect(test.acknowledgeDocumentCommit).not.toHaveBeenCalled();
  });

  it('retains the working review if loading a refreshed destination fails', async () => {
    const test = setup();
    test.commit.mockResolvedValueOnce({status: 'conflict', message: 'Changed', applied: null, noteId: null, committedMarkdown: null});
    test.reloadReviewDocument.mockRejectedValueOnce(new Error('Destination unavailable'));
    const refresh = async () => ({...test.request, preview: {...preview, baseContentHash: 'new-hash'}});
    await test.orchestration.loadDurableProposal({...test.request, refresh});
    await test.orchestration.keepAll();
    expect(test.firstEditor.markdown).toBe('After');
    expect(test.firstEditor.review?.reviewId).toBe('review-1');
    expect(test.session.snapshot.error).toContain('Destination unavailable');
    expect(documentRegistry.isReviewing(test.document.handle)).toBe(true);
  });

  it('does not replace a dismissal in progress', async () => {
    const test = setup();
    let releaseDismiss!: () => void;
    test.dismiss.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseDismiss = resolve;
        })
    );
    await test.orchestration.loadDurableProposal(test.request);
    const dismissing = test.orchestration.undoAll();
    expect(test.session.workflow.kind).toBe('dismissing');

    const replacement = {
      ...test.request,
      proposalId: 'proposal-2',
      preview: { ...preview, reviewId: 'review-2' }
    };
    await expect(
      test.orchestration.loadDurableProposal(replacement)
    ).resolves.toBe(false);
    expect(test.orchestration.activeProposalId).toBe('proposal-1');

    releaseDismiss();
    await dismissing;
    expect(test.orchestration.activeProposalId).toBeNull();
  });

  it('requires confirmation before reloading a conflicted Keep with no unresolved hunks', async () => {
    const test = setup();
    test.commit.mockResolvedValueOnce({status:'conflict',committedMarkdown:null,applied:null,noteId:null,message:'Changed on disk.'});
    test.reloadReviewDocument.mockImplementationOnce(async () => { test.firstEditor.runtime.adoptCommittedMarkdown('Newer canonical authored text'); });
    await test.orchestration.loadDurableProposal(test.request);
    await test.orchestration.keepAll();
    expect(test.session.snapshot).toMatchObject({isConflicted:true,unresolvedHunks:0});
    const before = {markdown:test.firstEditor.markdown,title:test.document.working.title,hunks:test.firstEditor.review!.hunks.map(hunk => ({...hunk}))};

    await test.orchestration.reloadDisk();
    expect(test.dismiss).not.toHaveBeenCalled();
    expect(test.session.workflow).toMatchObject({
      kind: 'confirmingDiscard',
      recoverTo: 'conflicted'
    });
    expect(test.firstEditor.markdown).toBe(before.markdown);
    expect(test.document.working.title).toBe(before.title);
    expect(test.firstEditor.review!.hunks).toEqual(before.hunks);
    expect(test.reloadReviewDocument).not.toHaveBeenCalled();

    await test.orchestration.reloadDisk();
    expect(test.dismiss).toHaveBeenCalledOnce();
    expect(test.reloadReviewDocument).toHaveBeenCalledWith(test.document);
    expect(test.orchestration.activeProposalId).toBeNull();
    expect(test.firstEditor.markdown).toBe('Newer canonical authored text');
    expect(test.commit).toHaveBeenCalledOnce();
  });

  it('admits confirmed reload only once while dismissal is pending', async () => {
    const test = setup();
    let finish!: () => void;
    test.dismiss.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await test.orchestration.loadDurableProposal(test.request);
    await test.orchestration.reloadDisk();
    const pending = test.orchestration.reloadDisk();
    await test.orchestration.reloadDisk();
    expect(test.dismiss).toHaveBeenCalledOnce();
    finish();
    await pending;
    expect(test.reloadReviewDocument).toHaveBeenCalledExactlyOnceWith(test.document);
  });
  it('maps a modified hunk, undoes the other hunk and commits the retained local text once', async () => {
    const test = setup();
    const multi: ProposalPreview = { ...preview, proposedEditorMarkdown: 'After\nNew', hunks: [
      preview.hunks[0],
      { id: 'second', baseFrom: 6, baseTo: 6, proposedFrom: 5, proposedTo: 9, oldText: '', newText: '\nNew' }
    ] };
    await test.orchestration.loadDurableProposal({ ...test.request, preview: multi });
    test.firstEditor.view.dispatch({ changes: { from: 0, to: 5, insert: 'My longer text' } });
    expect(test.firstEditor.review?.hunks).toMatchObject([
      { id: 'hunk-1', status: 'modified', from: 0, to: 14 },
      { id: 'second', status: 'pending', from: 14, to: 18 }
    ]);
    await test.orchestration.undoAll();
    expect(test.firstEditor.markdown).toBe('My longer text');
    expect(test.commit).not.toHaveBeenCalled(); expect(test.dismiss).not.toHaveBeenCalled();
    await test.orchestration.keepAll();
    expect(test.commit).toHaveBeenCalledExactlyOnceWith('My longer text');
  });

  it('installs and resolves the real review fields in both sibling editor states', async () => {
    const test = setup({ sibling: true });
    await test.orchestration.loadDurableProposal(test.request);
    expect(test.firstEditor.review).toEqual(test.siblingEditor!.review);
    const pending = test.orchestration.keepAll();
    expect(test.siblingEditor!.review?.hunks[0].status).toBe('kept');
    expect(test.session.snapshot.unresolvedHunks).toBe(0);
    await pending;
    expect(test.commit).toHaveBeenCalledExactlyOnceWith('After');
    expect(test.firstEditor.installed).toBe(false); expect(test.siblingEditor!.installed).toBe(false);
  });

});
