import { describe, expect, it } from 'vitest';
import {
  buildProposalPreview,
  getCurrentProposalUpdate,
  getProposalDisplayTitle,
  isDocumentUnderProposal
} from './proposalController';
import type { ReviewUpdateChange } from '$lib/features/inbox/reviewDiff';
import type { ProposalSession } from '$lib/features/proposals/session';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';

function updateChange(overrides: Partial<ReviewUpdateChange> = {}): ReviewUpdateChange {
  return {
    id: 'updateNote:/vault/Note.md',
    kind: 'updateNote',
    path: '/vault/Note.md',
    baseContentHash: 'hash',
    currentTitle: 'Current',
    currentMarkdown: 'one\ntwo\nthree',
    proposedTitle: 'Proposed',
    proposedMarkdown: 'one\nTWO\nthree',
    titleChanged: true,
    titleSelected: true,
    hunks: [
      {
        id: 'hunk-1',
        selected: true,
        oldStart: 1,
        oldEnd: 2,
        newLines: ['TWO'],
        lines: []
      }
    ],
    ...overrides
  };
}

function proposalSession(change: ReviewUpdateChange): ProposalSession {
  return {
    itemId: 1,
    kind: 'remember',
    status: 'pendingApproval',
    title: 'Proposal',
    summary: '',
    sourcePath: '/vault/Note.md',
    sourceTitle: 'Current',
    sourceMarkdown: change.currentMarkdown,
    reviewChanges: [change],
    notePaths: [change.path],
    focusedPath: change.path,
    createdAtMillis: 1,
    updatedAtMillis: 1
  };
}

describe('proposalController', () => {
  it('builds selected update previews without mixing render code into Notepad', () => {
    const preview = buildProposalPreview(updateChange());

    expect(preview).toEqual({
      title: 'Proposed',
      markdown: 'one\nTWO\nthree'
    });
  });

  it('falls back to current title and only selected hunks for partial proposals', () => {
    const preview = buildProposalPreview(
      updateChange({
        titleSelected: false,
        hunks: [
          {
            id: 'hunk-1',
            selected: false,
            oldStart: 1,
            oldEnd: 2,
            newLines: ['TWO'],
            lines: []
          }
        ]
      })
    );

    expect(preview).toEqual({
      title: 'Current',
      markdown: 'one\ntwo\nthree'
    });
  });

  it('detects proposal ownership and display title for a note document', () => {
    const change = updateChange();
    const session = proposalSession(change);
    const document = createNoteDraftState({
      title: 'Draft title',
      bodyMarkdown: '',
      currentNoteId: 'note-id',
      currentNotePath: change.path,
      lastSavedTitle: 'Draft title',
      lastSavedMarkdown: '',
      lastSavedNoteId: 'note-id',
      lastSavedPath: change.path
    });

    expect(getCurrentProposalUpdate(session.reviewChanges)).toBe(change);
    expect(isDocumentUnderProposal(session, document)).toBe(true);
    expect(getProposalDisplayTitle(session, document)).toBe('Proposed');
  });
});
