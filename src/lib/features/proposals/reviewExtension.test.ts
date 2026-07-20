import { EditorState, Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { createProposalReviewExtension } from './reviewExtension';

describe('proposal review hunk mapping', () => {
  it('tracks the complete edited proposed span for Restore Original', () => {
    const review = createProposalReviewExtension({
      reviewId: 'review',
      hunks: [{
        id: 'hunk-1',
        baseFrom: 0,
        baseTo: 7,
        proposedFrom: 0,
        proposedTo: 'Fixture (revised)'.length,
        oldText: 'Fixture',
        newText: 'Fixture (revised)'
      }],
      onKeep: () => {},
      onUndo: () => {}
    });
    const state = EditorState.create({ doc: 'Fixture (revised)', extensions: review.extension });
    const next = state.update({ changes: { from: 0, to: 7, insert: 'Fixture test' } }).state;
    const hunk = review.read(next).hunks[0];

    expect(next.doc.toString().slice(hunk.from, hunk.to)).toBe('Fixture test (revised)');
    expect(hunk.status).toBe('modified');
  });

  it('does not turn every hunk into a modification during a pane document reset', () => {
    const review = createProposalReviewExtension({
      reviewId: 'review',
      hunks: [{
        id: 'hunk-1',
        baseFrom: 0,
        baseTo: 7,
        proposedFrom: 0,
        proposedTo: 'Fixture (revised)'.length,
        oldText: 'Fixture',
        newText: 'Fixture (revised)'
      }],
      onKeep: () => {},
      onUndo: () => {}
    });
    const doc = 'Fixture (revised) draft note';
    const state = EditorState.create({ doc, extensions: review.extension });
    const next = state.update({
      changes: { from: 0, to: doc.length, insert: doc },
      annotations: Transaction.userEvent.of('input.external-reset')
    }).state;
    const hunk = review.read(next).hunks[0];

    expect(hunk).toMatchObject({ from: 0, to: 'Fixture (revised)'.length, status: 'pending' });
  });

  it('reinstalls a suspended hunk snapshot unchanged in a newly mounted pane', () => {
    const hunk = {
      id: 'hunk-1',
      baseFrom: 0,
      baseTo: 7,
      proposedFrom: 0,
      proposedTo: 'Fixture (revised)'.length,
      oldText: 'Fixture',
      newText: 'Fixture (revised)'
    };
    const doc = 'Fixture (revised) draft note\n\nFixture insertion.';
    const firstPane = createProposalReviewExtension({
      reviewId: 'review', hunks: [hunk], onKeep: () => {}, onUndo: () => {}
    });
    const suspended = firstPane.read(EditorState.create({ doc, extensions: firstPane.extension })).hunks;
    const secondPane = createProposalReviewExtension({
      reviewId: 'review', hunks: [hunk], initialHunks: suspended, onKeep: () => {}, onUndo: () => {}
    });
    const restored = secondPane.read(EditorState.create({ doc, extensions: secondPane.extension })).hunks[0];

    expect(restored).toMatchObject({ from: 0, to: 'Fixture (revised)'.length, status: 'pending' });
  });
});
