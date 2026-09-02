import { describe, expect, it, vi } from 'vitest';
import type { StateEffect } from '@codemirror/state';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import type {
  CommitNoteReviewResult,
  ProposalPreview
} from '$lib/types/proposals';
import type { ProposalReviewState } from './reviewExtension';
import { createProposalReviewSession } from './reviewSession.svelte';
import { createProposalOrchestration } from './proposalOrchestration';

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
    lastSavedTitle: 'Plan',
    lastSavedMarkdown: 'Before',
    lastSavedPath: path
  });
}

function fakeEditor(initialMarkdown = 'Before') {
  let markdown = initialMarkdown;
  let review: ProposalReviewState | null = null;
  let installed = false;
  let reviewExtensionUpdates = 0;
  let documentAvailable = true;
  let staleReviewReader = false;

  function applyChange(change: { from: number; to: number; insert: string }) {
    markdown =
      markdown.slice(0, change.from) +
      change.insert +
      markdown.slice(change.to);
  }

  const adapter: EditorCapabilityAdapter = {
    isReady: () => true,
    focus: () => true,
    focusAtEnd: () => true,
    readSnapshot: () => null,
    readSelection: () => null,
    readCurrentBlock: () => null,
    replaceDocument: (next) => {
      markdown = next;
      return true;
    },
    insertMarkdown: () => null,
    setSearchHighlight: () => false,
    focusSearchRange: () => false,
    focusSelection: () => false,
    closeSlashMenu: () => {},
    closeSelectionMenu: () => {},
    addReadOnlyOverlay: () => ({ dispose: () => undefined }),
    setProposalReviewExtensions: (extension) => {
      reviewExtensionUpdates += 1;
      installed = extension !== null;
      review = installed
        ? {
            reviewId: preview.reviewId,
            hunks: preview.hunks.map((hunk) => ({
              ...hunk,
              from: hunk.proposedFrom,
              to: hunk.proposedTo,
              status: 'pending'
            }))
          }
        : null;
      return true;
    },
    setProposalReviewStateReader: (reader) => {
      if (reader === null) staleReviewReader = false;
    },
    readProposalReviewState: () => {
      if (staleReviewReader) {
        throw new RangeError('Field is not present in this state');
      }
      return review;
    },
    focusProposalHunk: () => true,
    applyChanges: (changes) => {
      const all = (Array.isArray(changes) ? changes : [changes]) as Array<{
        from: number;
        to: number;
        insert: string;
      }>;
      for (const change of [...all].sort((left, right) => right.from - left.from)) {
        applyChange(change);
      }
      return true;
    },
    dispatchEffects: (effects) => {
      const all = (Array.isArray(effects) ? effects : [effects]) as StateEffect<{
        id: string;
        status: ProposalReviewState['hunks'][number]['status'];
      }>[];
      for (const effect of all) {
        if (!review) continue;
        review = {
          ...review,
          hunks: review.hunks.map((hunk) =>
            hunk.id === effect.value.id
              ? { ...hunk, status: effect.value.status }
              : hunk
          )
        };
      }
      return true;
    },
    getDocumentText: () => documentAvailable ? markdown : null
  };

  return {
    adapter,
    get markdown() {
      return markdown;
    },
    get installed() {
      return installed;
    },
    get reviewExtensionUpdates() {
      return reviewExtensionUpdates;
    },
    setDocumentAvailable(available: boolean) {
      documentAvailable = available;
    },
    replaceEditorStateWithoutReview() {
      // Mirrors swapEditorRuntime: document text survives through the shared
      // runtime, while the new EditorState starts without the review field.
      installed = false;
      review = null;
      staleReviewReader = true;
    }
  };
}

function setup(options: { opened?: boolean } = {}) {
  const document = note();
  const firstEditor = fakeEditor();
  const session = createProposalReviewSession();
  let opened = options.opened ?? false;
  let currentEditor = firstEditor;
  // Mirrors the real adapter, which resolves an editor only from panes that
  // currently display the requested document.
  let editorDocument: ReturnType<typeof note> | null = document;
  const commit = vi.fn<() => Promise<CommitNoteReviewResult>>(
    async () => ({
      status: 'committed',
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
  const ensureEditorPaneForReview = vi.fn(async () => undefined);
  const openNoteForReview = vi.fn(async () => {
    opened = true;
    return document;
  });
  const activateEditorPane = vi.fn(async () => undefined);
  const reloadReviewFromDisk = vi.fn(async () => undefined);
  const orchestration = createProposalOrchestration({
    getEditorPaneDocument: (requestedPath) =>
      opened && requestedPath === path ? document : null,
    getEditorForDocument: (requested) =>
      requested === editorDocument ? currentEditor.adapter : null,
    ensureEditorPaneForReview,
    openNoteForReview,
    activateEditorPane,
    reopenReviewEditor: vi.fn(async () => currentEditor.adapter),
    reloadReviewFromDisk,
    acknowledgeDocumentCommit,
    session
  });

  return {
    document,
    firstEditor,
    session,
    commit,
    dismiss,
    acknowledgeDocumentCommit,
    ensureEditorPaneForReview,
    openNoteForReview,
    activateEditorPane,
    reloadReviewFromDisk,
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

describe('durable proposal editor review', () => {
  it('passively installs a proposal in an existing editor without navigating or focusing', async () => {
    const test = setup({ opened: true });
    const focusProposalHunk = vi.spyOn(
      test.firstEditor.adapter,
      'focusProposalHunk'
    );

    await expect(
      test.orchestration.loadDurableProposalIfOpen(test.request)
    ).resolves.toBe(true);

    expect(test.firstEditor.markdown).toBe('After');
    expect(test.firstEditor.installed).toBe(true);
    expect(test.ensureEditorPaneForReview).not.toHaveBeenCalled();
    expect(test.openNoteForReview).not.toHaveBeenCalled();
    expect(test.activateEditorPane).not.toHaveBeenCalled();
    expect(focusProposalHunk).not.toHaveBeenCalled();
  });

  it('leaves a closed proposal target queued without opening a pane', async () => {
    const test = setup();

    await expect(
      test.orchestration.loadDurableProposalIfOpen(test.request)
    ).resolves.toBe(false);

    expect(test.firstEditor.installed).toBe(false);
    expect(test.openNoteForReview).not.toHaveBeenCalled();
    expect(test.activateEditorPane).not.toHaveBeenCalled();
    expect(test.orchestration.activeProposalId).toBeNull();
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
      totalHunks: 1,
      unresolvedHunks: 1
    });
    expect(test.orchestration.isReviewingProposal('proposal-1')).toBe(true);
  });

  it('restores the pending review after the editor pane is switched away and back', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);

    test.orchestration.suspendDocument(test.document, test.firstEditor.adapter);
    expect(test.firstEditor.installed).toBe(false);

    const remounted = fakeEditor('Before');
    test.orchestration.attachEditor(test.document, remounted.adapter);

    expect(remounted.markdown).toBe('After');
    expect(remounted.installed).toBe(true);
    expect(remounted.adapter.readProposalReviewState?.()?.hunks[0].status).toBe(
      'pending'
    );
  });

  it('reattaches controls when navigation replaces the editor state but preserves proposed text', async () => {
    const test = setup({ opened: true });
    await test.orchestration.loadDurableProposalIfOpen(test.request);
    expect(test.firstEditor.markdown).toBe('After');

    test.firstEditor.replaceEditorStateWithoutReview();
    expect(test.firstEditor.installed).toBe(false);

    expect(() =>
      test.orchestration.attachEditor(
        test.document,
        test.firstEditor.adapter
      )
    ).not.toThrow();

    expect(test.firstEditor.markdown).toBe('After');
    expect(test.firstEditor.installed).toBe(true);
    expect(
      test.firstEditor.adapter.readProposalReviewState?.()?.hunks[0]
    ).toMatchObject({ status: 'pending' });
  });

  it('does not reinstall a review in a pane that already presents it', async () => {
    const test = setup({ opened: true });
    await test.orchestration.loadDurableProposalIfOpen(test.request);
    const updatesAfterInitialInstall =
      test.firstEditor.reviewExtensionUpdates;

    test.orchestration.attachEditor(
      test.document,
      test.firstEditor.adapter
    );

    expect(test.firstEditor.reviewExtensionUpdates).toBe(
      updatesAfterInitialInstall
    );
    expect(test.firstEditor.installed).toBe(true);
  });

  it('keeps a suspended review bound to its own note while the pane shows another note', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    expect(test.firstEditor.markdown).toBe('After');

    // Leaving the proposed note releases the review's editor.
    test.orchestration.suspendDocument(test.document, test.firstEditor.adapter);

    // The same pane now presents an unrelated note through the same adapter.
    test.firstEditor.adapter.replaceDocument('Unrelated note body');
    test.setEditorDocument(null);

    // A review action arriving while the pane shows another note must not adopt
    // that note's text as the proposed working copy.
    test.orchestration.keepAll();
    test.orchestration.undoAll();

    // Returning to the proposed note restores the proposal, not the other note.
    const remounted = fakeEditor('Before');
    test.setCurrentEditor(remounted);
    test.setEditorDocument(test.document);

    expect(test.orchestration.restoreDocument(test.document)).toBe(true);
    expect(test.document.working.markdown).toBe('After');

    test.orchestration.attachEditor(test.document, remounted.adapter);

    expect(remounted.markdown).toBe('After');
    expect(remounted.installed).toBe(true);
    expect(test.commit).not.toHaveBeenCalled();
  });

  it('reactivates a remounted editor before focusing the next hunk', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.orchestration.suspendDocument(test.document, test.firstEditor.adapter);

    const remounted = fakeEditor('Before');
    const focus = vi.spyOn(remounted.adapter, 'focusProposalHunk');
    test.setCurrentEditor(remounted);

    await test.orchestration.reviewNext();

    expect(remounted.markdown).toBe('After');
    expect(remounted.installed).toBe(true);
    expect(focus).toHaveBeenCalledWith('hunk-1');
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
    expect(test.dismiss).not.toHaveBeenCalled();
  });

  it('commits kept editor text through the durable proposal callback', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);

    test.orchestration.keepAll();
    await vi.waitFor(() => expect(test.commit).toHaveBeenCalledWith('After'));
    await vi.waitFor(() =>
      expect(test.orchestration.activeProposalId).toBeNull()
    );

    expect(test.session.isReviewingDocument(test.document)).toBe(false);
    expect(test.session.snapshot.proposalId).toBeNull();
    expect(test.acknowledgeDocumentCommit).toHaveBeenCalledWith({
      document: test.document,
      path,
      markdown: 'After'
    });
  });

  it('commits the captured working copy if the editor remounts during Keep All', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.firstEditor.setDocumentAvailable(false);

    test.orchestration.keepAll();
    await vi.waitFor(() => expect(test.commit).toHaveBeenCalledWith('After'));
    await vi.waitFor(() =>
      expect(test.orchestration.activeProposalId).toBeNull()
    );

    expect(test.session.snapshot.error).toBeNull();
    expect(test.orchestration.activeProposalId).toBeNull();
  });

  it('recovers a commit conflict through the same review state', async () => {
    const test = setup();
    test.commit.mockResolvedValueOnce({
      status: 'conflict',
      applied: null,
      noteId: null,
      message: 'Changed on disk.'
    });
    await test.orchestration.loadDurableProposal(test.request);

    test.orchestration.keepAll();
    await vi.waitFor(() =>
      expect(test.session.workflow.kind).toBe('conflicted')
    );
    expect(test.session.snapshot.isApplying).toBe(false);
    expect(test.session.snapshot.error).toBe('Changed on disk.');

    test.orchestration.retryCommit();
    await vi.waitFor(() =>
      expect(test.orchestration.activeProposalId).toBeNull()
    );
    expect(test.commit).toHaveBeenCalledTimes(2);
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
    test.orchestration.undoAll();
    await vi.waitFor(() =>
      expect(test.session.workflow.kind).toBe('dismissing')
    );

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
    await vi.waitFor(() =>
      expect(test.orchestration.activeProposalId).toBeNull()
    );
  });

  it('requires confirmation before dismissing and reloading a conflict', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.orchestration.markConflict(path);

    await test.orchestration.reloadDisk();
    expect(test.dismiss).not.toHaveBeenCalled();
    expect(test.session.workflow).toMatchObject({
      kind: 'confirmingDiscard',
      recoverTo: 'conflicted'
    });

    await test.orchestration.reloadDisk();
    expect(test.dismiss).toHaveBeenCalledOnce();
    expect(test.reloadReviewFromDisk).toHaveBeenCalledWith(path);
    expect(test.orchestration.activeProposalId).toBeNull();
  });

  it('restores the original body and dismisses the durable proposal on Undo', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);

    test.orchestration.undoAll();
    await vi.waitFor(() => expect(test.dismiss).toHaveBeenCalledOnce());

    expect(test.firstEditor.markdown).toBe('Before');
    expect(test.session.isReviewingDocument(test.document)).toBe(false);
    expect(test.commit).not.toHaveBeenCalled();
  });
});
