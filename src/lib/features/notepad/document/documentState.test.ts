import { describe, expect, it } from 'vitest';
import {
  applySessionSnapshotToDocument,
  beginDocumentOperation,
  captureExternalDeletionConflict,
  captureExternalSnapshotConflict,
  completeDocumentOperation,
  createDocumentState,
  documentHasCleanBuffer,
  documentToSessionSnapshot,
  failDocumentOperation,
  getDocumentStatusViewModel,
  resolveConflictKeepingWorking,
  resolveConflictUsingExternal,
  updateDocumentMarkdown,
  updateDocumentTitle,
  type DocumentOperationKind
} from './documentState';
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
    'remembering',
    'forgetting',
    'opening'
  ] satisfies DocumentOperationKind[])(
    'tracks and completes a tokenized %s operation',
    (kind) => {
      const document = createDocumentState(
        snapshot(),
        `path:${path}`
      );

      const token = beginDocumentOperation(document, kind);

      expect(document.operation).toMatchObject({
        kind,
        token,
        revision: 0
      });
      expect(completeDocumentOperation(document, token)).toBe(
        true
      );
      expect(document.operation.kind).toBe('idle');
      expect(
        completeDocumentOperation(document, token - 1)
      ).toBe(false);
    }
  );

  it('rejects stale failures without replacing a newer operation', () => {
    const document = createDocumentState(
      snapshot(),
      `path:${path}`
    );
    const staleToken = beginDocumentOperation(
      document,
      'saving'
    );
    const currentToken = beginDocumentOperation(
      document,
      'opening'
    );

    expect(
      failDocumentOperation(
        document,
        'saving',
        new Error('old failure'),
        staleToken
      )
    ).toBe(false);
    expect(document.operation).toMatchObject({
      kind: 'opening',
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
    expect(document.externalSync.kind).toBe('dirty');
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

      captureExternalSnapshotConflict(
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
    captureExternalSnapshotConflict(
      keepLocal,
      snapshot({
        bodyMarkdown: 'external body',
        lastSavedMarkdown: 'external body'
      }),
      'watcher'
    );

    expect(resolveConflictKeepingWorking(keepLocal)).toBe(
      true
    );
    expect(keepLocal.working.markdown).toBe('local body');
    expect(keepLocal.externalSync.kind).toBe('dirty');

    const useExternal = createDocumentState(
      snapshot(),
      `path:${path}`
    );
    updateDocumentMarkdown(useExternal, 'local body');
    captureExternalSnapshotConflict(
      useExternal,
      snapshot({
        bodyMarkdown: 'external body',
        lastSavedMarkdown: 'external body'
      }),
      'watcher'
    );

    expect(resolveConflictUsingExternal(useExternal)).toBe(
      true
    );
    expect(useExternal.working.markdown).toBe(
      'external body'
    );
    expect(useExternal.externalSync.kind).toBe('inSync');
  });

  it('turns a conflicted external deletion into a recoverable draft', () => {
    const document = createDocumentState(
      snapshot(),
      `path:${path}`
    );
    updateDocumentMarkdown(document, 'local body');
    captureExternalDeletionConflict(
      document,
      path,
      'watcher'
    );

    expect(resolveConflictUsingExternal(document)).toBe(true);
    expect(document.identity).toEqual({ kind: 'draft' });
    expect(document.savedBaseline).toBeNull();
    expect(document.working.markdown).toBe('local body');
    expect(document.externalSync.kind).toBe('dirty');
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
    expect(document.externalSync.kind).toBe('inSync');
  });
});
