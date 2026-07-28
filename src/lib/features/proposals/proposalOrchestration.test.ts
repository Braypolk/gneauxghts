import { describe, expect, it, vi } from 'vitest';
import type { StateEffect } from '@codemirror/state';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { ProposalPreview } from '$lib/types/proposals';
import type { ProposalReviewState } from './reviewExtension';
import { createReviewHoldStore } from './reviewHold.svelte';
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
  let documentAvailable = true;

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
    closeSlashMenu: () => {},
    closeSelectionMenu: () => {},
    addReadOnlyOverlay: () => ({ dispose: () => undefined }),
    setProposalReviewExtensions: (extension) => {
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
    setProposalReviewStateReader: () => undefined,
    readProposalReviewState: () => review,
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
    setDocumentAvailable(available: boolean) {
      documentAvailable = available;
    }
  };
}

function setup() {
  const document = note();
  const firstEditor = fakeEditor();
  const session = createProposalReviewSession();
  const holds = createReviewHoldStore();
  let opened = false;
  let currentEditor = firstEditor;
  const commit = vi.fn(async () => ({
    status: 'committed' as const,
    applied: {
      kind: 'updateNote',
      path,
      previousPath: path
    },
    message: null
  }));
  const dismiss = vi.fn(async () => undefined);
  const refreshDocumentAfterKeep = vi.fn(async () => undefined);
  const orchestration = createProposalOrchestration({
    getEditorPaneDocument: (requestedPath) =>
      opened && requestedPath === path ? document : null,
    getEditorForDocument: () => currentEditor.adapter,
    ensureEditorPaneForReview: vi.fn(async () => undefined),
    openNoteForReview: vi.fn(async () => {
      opened = true;
      return document;
    }),
    activateEditorPane: vi.fn(async () => undefined),
    reopenReviewEditor: vi.fn(async () => currentEditor.adapter),
    refreshDocumentAfterKeep,
    session,
    holds
  });

  return {
    document,
    firstEditor,
    session,
    holds,
    commit,
    dismiss,
    refreshDocumentAfterKeep,
    orchestration,
    setCurrentEditor: (editor: ReturnType<typeof fakeEditor>) => {
      currentEditor = editor;
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
  it('opens the target note and installs the proposed body and live hunks', async () => {
    const test = setup();

    await expect(
      test.orchestration.loadDurableProposal(test.request)
    ).resolves.toBe(true);

    expect(test.firstEditor.markdown).toBe('After');
    expect(test.firstEditor.installed).toBe(true);
    expect(test.holds.isHolding(test.document.key)).toBe(true);
    expect(test.session.snapshot.reviewHunks).toEqual({
      total: 1,
      unresolved: 1
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

    expect(test.holds.isHolding(test.document.key)).toBe(false);
    expect(test.session.snapshot.changes).toEqual([]);
    expect(test.refreshDocumentAfterKeep).toHaveBeenCalledWith(path);
  });

  it('commits the captured working copy if the editor remounts during Keep All', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);
    test.firstEditor.setDocumentAvailable(false);

    test.orchestration.keepAll();
    await vi.waitFor(() => expect(test.commit).toHaveBeenCalledWith('After'));

    expect(test.session.snapshot.error).toBeNull();
    expect(test.orchestration.activeProposalId).toBeNull();
  });

  it('restores the original body and dismisses the durable proposal on Undo', async () => {
    const test = setup();
    await test.orchestration.loadDurableProposal(test.request);

    test.orchestration.undoAll();
    await vi.waitFor(() => expect(test.dismiss).toHaveBeenCalledOnce());

    expect(test.firstEditor.markdown).toBe('Before');
    expect(test.holds.isHolding(test.document.key)).toBe(false);
    expect(test.commit).not.toHaveBeenCalled();
  });
});
