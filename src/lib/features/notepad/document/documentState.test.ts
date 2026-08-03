import { describe, expect, it } from 'vitest';
import {
  applySessionSnapshotToDocument,
  createDocumentState,
  documentHasCleanBuffer,
  documentToSessionSnapshot,
  dispatchDocumentExternalSync,
  dispatchDocumentOperation,
  getDocumentStatusViewModel,
  resolveConflictUsingExternal,
  updateDocumentMarkdown,
  updateDocumentTitle,
  type DocumentOperationKind
} from './documentState';
import {
  captureExternalDeletionForTest,
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
        `path:${path}`
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

  it('rejects stale failures without replacing a newer operation', () => {
    const document = createDocumentState(
      snapshot(),
      `path:${path}`
    );
    dispatchDocumentOperation(document, {
      type: 'start',
      operation: 'saving'
    });
    const staleToken = document.operation.token;
    dispatchDocumentOperation(document, {
      type: 'start',
      operation: 'forgetting'
    });
    const currentToken = document.operation.token;

    expect(
      dispatchDocumentOperation(document, {
        type: 'fail',
        error: new Error('old failure'),
        token: staleToken
      })
    ).toBe(false);
    expect(document.operation).toMatchObject({
      kind: 'forgetting',
      token: currentToken
    });
  });

  it('advances revision only for real working-content changes', () => {
    const document = createDocumentState(
      snapshot(),
      `path:${path}`
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
      `path:${path}`
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
    ['watcher', 'snapshot'],
    ['taskMutation', 'snapshot'],
    ['windowFocus', 'snapshot'],
    ['visibility', 'snapshot']
  ] as const)(
    'captures a recoverable %s %s conflict without overwriting working content',
    (source, _changeKind) => {
      const document = createDocumentState(
        snapshot(),
        `path:${path}`
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

  it('can keep local work or apply the captured external snapshot', () => {
    const keepLocal = createDocumentState(
      snapshot(),
      `path:${path}`
    );
    updateDocumentMarkdown(keepLocal, 'local body');
    const keepConflictId = captureExternalSnapshotForTest(
      keepLocal,
      snapshot({
        bodyMarkdown: 'external body',
        lastSavedMarkdown: 'external body'
      }),
      'watcher'
    );

    expect(
      dispatchDocumentExternalSync(keepLocal, {
        type: 'keepWorking',
        conflictId: keepConflictId!
      })
    ).toBe(true);
    expect(keepLocal.working.markdown).toBe('local body');
    expect(keepLocal.externalSync.kind).toBe('noConflict');

    const useExternal = createDocumentState(
      snapshot(),
      `path:${path}`
    );
    updateDocumentMarkdown(useExternal, 'local body');
    const externalConflictId = captureExternalSnapshotForTest(
      useExternal,
      snapshot({
        bodyMarkdown: 'external body',
        lastSavedMarkdown: 'external body'
      }),
      'watcher'
    );

    expect(
      dispatchDocumentExternalSync(useExternal, {
        type: 'beginApplyingExternal',
        conflictId: externalConflictId!
      })
    ).toBe(true);
    expect(
      resolveConflictUsingExternal(
        useExternal,
        externalConflictId!
      )
    ).toBe(true);
    expect(useExternal.working.markdown).toBe(
      'external body'
    );
    expect(useExternal.externalSync.kind).toBe('noConflict');
  });

  it('turns a conflicted external deletion into a recoverable draft', () => {
    const document = createDocumentState(
      snapshot(),
      `path:${path}`
    );
    updateDocumentMarkdown(document, 'local body');
    const conflictId = captureExternalDeletionForTest(
      document,
      path,
      'watcher'
    );

    expect(
      dispatchDocumentExternalSync(document, {
        type: 'beginApplyingExternal',
        conflictId: conflictId!
      })
    ).toBe(true);
    expect(
      resolveConflictUsingExternal(document, conflictId!)
    ).toBe(true);
    expect(document.identity).toEqual({ kind: 'draft' });
    expect(document.savedBaseline).toBeNull();
    expect(document.working.markdown).toBe('local body');
    expect(document.externalSync.kind).toBe('noConflict');
  });

  it('applies a clean external snapshot and advances one revision', () => {
    const document = createDocumentState(
      snapshot(),
      `path:${path}`
    );

    const result = applySessionSnapshotToDocument(
      document,
      snapshot({
        title: 'External title',
        bodyMarkdown: 'external body',
        lastSavedTitle: 'External title',
        lastSavedMarkdown: 'external body'
      })
    );

    expect(result).toEqual({
      titleChanged: true,
      markdownChanged: true
    });
    expect(document.operation.revision).toBe(1);
    expect(document.externalSync.kind).toBe('noConflict');
  });
});
