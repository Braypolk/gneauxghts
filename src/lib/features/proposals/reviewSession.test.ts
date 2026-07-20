import { describe, expect, it } from 'vitest';
import { createProposalReviewSession } from './reviewSession.svelte';
import type { NoteChange } from '$lib/types/proposals';

describe('createProposalReviewSession', () => {
  it('loads pending changes and tracks keep/undo', () => {
    const session = createProposalReviewSession();
    const changes: NoteChange[] = [
      {
        kind: 'updateNote',
        path: '/vault/A.md',
        baseContentHash: 'hash',
        newTitle: 'A',
        newMarkdown: 'new'
      },
      {
        kind: 'createNote',
        suggestedTitle: 'B',
        markdown: '# B\n'
      }
    ];

    session.load(changes, { '/vault/A.md': 'old' }, 'test');
    expect(session.pendingCount).toBe(2);
    expect(session.snapshot.activeChangeId).toBe('0:update:/vault/A.md');

    session.markUndone('0:update:/vault/A.md');
    expect(session.pendingCount).toBe(1);
    expect(session.getChange('0:update:/vault/A.md')?.status).toBe('undone');
    expect(session.snapshot.activeChangeId).toBe('1:create:B');

    session.markKept('1:create:B');
    expect(session.pendingCount).toBe(0);
    expect(session.snapshot.activeChangeId).toBeNull();
  });

  it('finds pending changes by path', () => {
    const session = createProposalReviewSession();
    session.load(
      [
        {
          kind: 'deleteNote',
          path: '/vault/Gone.md',
          baseContentHash: 'hash'
        }
      ],
      { '/vault/Gone.md': 'bye' },
      'test'
    );
    expect(session.findPendingForPath('/vault/Gone.md')?.change.kind).toBe('deleteNote');
    expect(session.findPendingForPath('/vault/Other.md')).toBeNull();
  });

  it('keeps conflict recovery separate from ordinary review errors', () => {
    const session = createProposalReviewSession();

    expect(session.snapshot.isConflicted).toBe(false);
    session.setError('Could not restore the original text.');
    expect(session.snapshot.isConflicted).toBe(false);
    session.setConflicted(true);
    expect(session.snapshot.isConflicted).toBe(true);
    session.setConflicted(false);
    expect(session.snapshot.isConflicted).toBe(false);
  });
});
