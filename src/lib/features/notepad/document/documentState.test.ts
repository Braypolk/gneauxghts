import { describe, expect, it } from 'vitest';
import {
  createDocumentState,
  documentHasCleanBuffer,
  documentToSessionSnapshot,
  dispatchDocumentOperation,
  getDocumentStatusViewModel,
  updateDocumentMarkdown,
  updateDocumentTitle,
  type DocumentOperationKind
} from './documentState';
import {
  captureExternalSnapshotForTest
} from './documentExternalSyncTestSupport';
import {
  createEmptySessionSnapshot,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';

const path = '/vault/note.md';

function snapshot(
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot {
  return {
    ...createEmptySessionSnapshot(),
    title: 'Saved title',
    bodyMarkdown: 'saved body',
    currentNoteId: 'note-id',
    currentNotePath: path,
    lastSavedTitle: 'Saved title',
    lastSavedMarkdown: 'saved body',
    lastSavedNoteId: 'note-id',
    lastSavedPath: path,
    ...overrides
  };
}

describe('document state transitions', () => {
  it.each([
    'saving',
    'forgetting'
  ] satisfies DocumentOperationKind[])(
    'tracks and completes a tokenized %s operation',
    (kind) => {
      const document = createDocumentState(
        snapshot(),
        `document:`
      );

      dispatchDocumentOperation(document, {
        type: 'start',
        operation: kind
      });
      const { token } = document.operation;

      expect(document.operation).toMatchObject({
        kind,
        token,
        revision: 0
      });
      expect(
        dispatchDocumentOperation(document, {
          type: 'succeed',
          token
        })
      ).toBe(true);
      expect(document.operation.kind).toBe('idle');
      expect(
        dispatchDocumentOperation(document, {
          type: 'succeed',
          token: token - 1
        })
      ).toBe(false);
    }
  );

  it('advances revision only for real working-content changes', () => {
    const document = createDocumentState(
      snapshot(),
      `document:`
    );

    expect(updateDocumentTitle(document, 'Saved title')).toBe(
      false
    );
    expect(
      updateDocumentMarkdown(document, 'local body')
    ).toBe(true);
    expect(document.operation.revision).toBe(1);
    expect(document.externalSync.kind).toBe('noConflict');
    expect(documentHasCleanBuffer(document)).toBe(false);
  });

  it('round-trips the boundary DTO without flat state mirrors', () => {
    const boundary = snapshot();
    const document = createDocumentState(
      boundary,
      `document:`
    );

    expect(documentToSessionSnapshot(document)).toEqual(
      boundary
    );
    expect(document).not.toHaveProperty('bodyMarkdown');
    expect(document).not.toHaveProperty('currentNotePath');
    expect(document).not.toHaveProperty('status');
  });
});

describe('external synchronization transitions', () => {
  it.each([
    ['watcher', 'snapshot']
  ] as const)(
    'captures a recoverable %s %s conflict without overwriting working content',
    (source, _changeKind) => {
      const document = createDocumentState(
        snapshot(),
        `document:`
      );
      updateDocumentMarkdown(document, 'local body');

      captureExternalSnapshotForTest(
        document,
        snapshot({
          bodyMarkdown: 'external body',
          lastSavedMarkdown: 'external body'
        }),
        source
      );

      expect(document.working.markdown).toBe('local body');
      expect(document.externalSync).toMatchObject({
        kind: 'conflict',
        external: {
          kind: 'snapshot',
          source,
          document: {
            content: { markdown: 'external body' }
          }
        }
      });
      expect(getDocumentStatusViewModel(document)).toEqual({
        kind: 'conflict',
        label: 'Changed outside the app',
        externalKind: 'snapshot'
      });
    }
  );
});
