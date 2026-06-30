import { describe, expect, it } from 'vitest';
import {
  buildNoteChangePreviews,
  buildNoteChangeReviewModel,
  type NoteChange
} from './proposals';

describe('buildNoteChangePreviews', () => {
  it('creates stable preview records for update/create/delete changes', () => {
    const changes: NoteChange[] = [
      {
        kind: 'updateNote',
        path: '/vault/Old.md',
        baseContentHash: 'hash',
        newTitle: 'New Title',
        newMarkdown: '# New Title\n\nBody'
      },
      {
        kind: 'createNote',
        suggestedTitle: '',
        markdown: '# Created From Body\n\nBody'
      },
      {
        kind: 'deleteNote',
        path: '/vault/Delete Me.md',
        baseContentHash: 'hash'
      }
    ];

    expect(buildNoteChangePreviews(changes)).toEqual([
      {
        id: '0:update:/vault/Old.md',
        kind: 'updateNote',
        title: 'New Title',
        path: '/vault/Old.md',
        proposedMarkdown: '# New Title\n\nBody'
      },
      {
        id: '1:create:',
        kind: 'createNote',
        title: 'Created From Body',
        path: null,
        proposedMarkdown: '# Created From Body\n\nBody'
      },
      {
        id: '2:delete:/vault/Delete Me.md',
        kind: 'deleteNote',
        title: 'Delete Me',
        path: '/vault/Delete Me.md',
        proposedMarkdown: null
      }
    ]);
  });
});

describe('buildNoteChangeReviewModel', () => {
  it('keeps review metadata source-agnostic and filters invalid apply inputs', () => {
    const changes: NoteChange[] = [
      {
        kind: 'updateNote',
        path: '/vault/Old.md',
        baseContentHash: 'hash',
        newTitle: 'New Title',
        newMarkdown: 'Body'
      },
      {
        kind: 'deleteNote',
        path: '/vault/Stale.md',
        baseContentHash: ''
      }
    ];

    expect(buildNoteChangeReviewModel(changes, 'test-tool')).toMatchObject({
      source: 'test-tool',
      items: [
        {
          actionLabel: 'Update',
          baseContentHash: 'hash',
          canApply: true
        },
        {
          actionLabel: 'Delete',
          baseContentHash: '',
          canApply: false
        }
      ],
      applyableChanges: [changes[0]]
    });
  });
});
