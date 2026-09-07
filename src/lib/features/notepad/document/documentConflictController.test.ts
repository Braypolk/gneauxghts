import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentState,
  resolveConflictUsingExternal,
  updateDocumentMarkdown
} from './documentState';
import {
  captureExternalDeletionForTest,
  captureExternalSnapshotForTest
} from './documentExternalSyncTestSupport';
import { createDocumentConflictController } from './documentConflictController';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import type {
  PaneEditorOperationResult
} from '$lib/features/notepad/pane/paneEditorLifecycle';

const path = '/vault/Note.md';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function conflictedDocument() {
  const saved = {
    ...createEmptySessionSnapshot(),
    title: 'Note',
    bodyMarkdown: 'saved',
    currentNoteId: 'note-1',
    currentNotePath: path,
    lastSavedTitle: 'Note',
    lastSavedMarkdown: 'saved',
    lastSavedNoteId: 'note-1',
    lastSavedPath: path
  };
  const document = createDocumentState(saved, `document:`);
  updateDocumentMarkdown(document, 'my edits');
  captureExternalSnapshotForTest(
    document,
    {
      ...saved,
      title: 'Disk title',
      bodyMarkdown: 'disk version',
      lastSavedTitle: 'Disk title',
      lastSavedMarkdown: 'disk version'
    },
    'watcher'
  );
  return document;
}

function setup() {
  const replaceDocumentContentInPlace = vi.fn<
    (
      document: ReturnType<typeof conflictedDocument>,
      markdown: string
    ) => Promise<PaneEditorOperationResult>
  >(async () => 'applied');
  const enqueueSave = vi.fn(async () => undefined);
  const copyText = vi.fn(async () => undefined);
  const refreshDerivedViews = vi.fn();
  const controller = createDocumentConflictController({
    replaceDocumentContentInPlace,
    enqueueSave,
    copyText,
    refreshDerivedViews,
    resolveUsingExternal: resolveConflictUsingExternal
  });
  return {
    controller,
    replaceDocumentContentInPlace,
    enqueueSave,
    copyText,
    refreshDerivedViews
  };
}

describe('document conflict controller', () => {
  it('keeps working content, resolves the conflict, then overwrites through normal save', async () => {
    const document = conflictedDocument();
    const harness = setup();

    await expect(
      harness.controller.keepMyEdits(document)
    ).resolves.toBe(true);

    expect(document.working.markdown).toBe('my edits');
    expect(document.externalSync.kind).toBe('noConflict');
    expect(harness.enqueueSave).toHaveBeenCalledWith(document);
    expect(
      harness.replaceDocumentContentInPlace
    ).not.toHaveBeenCalled();
  });

  it('loads the retained disk snapshot and fans it out to attached editors', async () => {
    const document = conflictedDocument();
    const harness = setup();

    await expect(
      harness.controller.loadDiskVersion(document)
    ).resolves.toBe(true);

    expect(document.working).toEqual({
      title: 'Disk title',
      markdown: 'disk version'
    });
    expect(document.externalSync.kind).toBe('noConflict');
    expect(
      harness.replaceDocumentContentInPlace
    ).toHaveBeenCalledWith(document, 'disk version');
    expect(harness.refreshDerivedViews).toHaveBeenCalledOnce();
    expect(harness.enqueueSave).not.toHaveBeenCalled();
  });

  it('applies retained deletion state while preserving recoverable text as a draft', async () => {
    const document = conflictedDocument();
    captureExternalDeletionForTest(
      document,
      path,
      'watcher'
    );
    const harness = setup();

    await harness.controller.loadDiskVersion(document);

    expect(document.identity).toEqual({ kind: 'draft' });
    expect(document.savedBaseline).toBeNull();
    expect(document.working.markdown).toBe('my edits');
    expect(document.externalSync.kind).toBe('noConflict');
    expect(
      harness.replaceDocumentContentInPlace
    ).toHaveBeenCalledWith(document, 'my edits');
  });

  it('copies working text without resolving or saving the conflict', async () => {
    const document = conflictedDocument();
    const harness = setup();

    await harness.controller.copyMyEdits(document);

    expect(harness.copyText).toHaveBeenCalledWith('my edits');
    expect(document.externalSync.kind).toBe('conflict');
    expect(harness.enqueueSave).not.toHaveBeenCalled();
  });

  it('does not save or replace content after another pane already resolved the conflict', async () => {
    const document = conflictedDocument();
    const harness = setup();
    await harness.controller.keepMyEdits(document);
    harness.enqueueSave.mockClear();

    await expect(
      harness.controller.keepMyEdits(document)
    ).resolves.toBe(false);
    await expect(
      harness.controller.loadDiskVersion(document)
    ).resolves.toBe(false);

    expect(harness.enqueueSave).not.toHaveBeenCalled();
    expect(
      harness.replaceDocumentContentInPlace
    ).not.toHaveBeenCalled();
  });

  it.each(['stale', 'disposed', 'unavailable'] as const)(
    'preserves the conflict and local model when editor replacement is %s',
    async (result) => {
      const document = conflictedDocument();
      const localState = {
        working: { ...document.working },
        identity: document.identity,
        savedBaseline: document.savedBaseline,
        externalSync: structuredClone(document.externalSync)
      };
      const harness = setup();
      harness.replaceDocumentContentInPlace.mockImplementation(
        async () => result
      );

      await expect(
        harness.controller.loadDiskVersion(document)
      ).resolves.toBe(false);

      expect(document.working).toEqual(localState.working);
      expect(document.identity).toBe(localState.identity);
      expect(document.savedBaseline).toBe(
        localState.savedBaseline
      );
      expect(document.externalSync).toEqual(
        localState.externalSync
      );
      expect(harness.refreshDerivedViews).not.toHaveBeenCalled();
    }
  );

  it('rolls back a partial editor fanout before preserving a stale conflict', async () => {
    const document = conflictedDocument();
    const harness = setup();
    harness.replaceDocumentContentInPlace
      .mockImplementationOnce(async (_document, markdown) => {
        return 'stale';
      })
      .mockImplementationOnce(async (_document, markdown) => {
        return 'applied';
      });

    await expect(
      harness.controller.loadDiskVersion(document)
    ).resolves.toBe(false);

    expect(
      harness.replaceDocumentContentInPlace.mock.calls.map(
        ([, markdown]) => markdown
      )
    ).toEqual(['disk version', 'my edits']);
    expect(document.working.markdown).toBe('my edits');
    expect(document.externalSync.kind).toBe('conflict');
    expect(harness.refreshDerivedViews).not.toHaveBeenCalled();
  });

  it('rolls the editor back when a concurrent model edit prevents commit', async () => {
    const document = conflictedDocument();
    const harness = setup();
    harness.replaceDocumentContentInPlace
      .mockImplementationOnce(async () => {
        document.working.title = 'new local title';
        document.operation = {
          ...document.operation,
          revision: document.operation.revision + 1
        };
        return 'applied';
      })
      .mockImplementationOnce(async () => 'applied');

    await expect(
      harness.controller.loadDiskVersion(document)
    ).resolves.toBe(false);

    expect(
      harness.replaceDocumentContentInPlace.mock.calls.map(
        ([, markdown]) => markdown
      )
    ).toEqual(['disk version', 'my edits']);
    expect(document.working).toEqual({
      title: 'new local title',
      markdown: 'my edits'
    });
    expect(document.externalSync.kind).toBe('conflict');
    expect(document.externalSync).toMatchObject({
      phase: 'awaitingChoice'
    });
  });

  it('rejects an old editor result after a newer external conflict is captured', async () => {
    const document = conflictedDocument();
    const harness = setup();
    const replacement = deferred<PaneEditorOperationResult>();
    harness.replaceDocumentContentInPlace
      .mockImplementationOnce(async () => replacement.promise)
      .mockImplementationOnce(async () => 'applied');

    const loading =
      harness.controller.loadDiskVersion(document);
    expect(document.externalSync).toMatchObject({
      kind: 'conflict',
      conflictId: 1,
      phase: 'applyingExternal'
    });

    captureExternalSnapshotForTest(
      document,
      {
        ...createEmptySessionSnapshot(),
        title: 'Newer disk title',
        bodyMarkdown: 'newer disk version',
        currentNoteId: 'note-1',
        currentNotePath: path,
        lastSavedTitle: 'Newer disk title',
        lastSavedMarkdown: 'newer disk version',
        lastSavedNoteId: 'note-1',
        lastSavedPath: path
      },
      'watcher'
    );
    replacement.resolve('applied');

    await expect(loading).resolves.toBe(false);
    expect(document.working.markdown).toBe('my edits');
    expect(document.externalSync).toMatchObject({
      kind: 'conflict',
      conflictId: 2,
      phase: 'awaitingChoice',
      external: {
        kind: 'snapshot',
        document: {
          content: { markdown: 'newer disk version' }
        }
      }
    });
    expect(
      harness.replaceDocumentContentInPlace.mock.calls.map(
        ([, markdown]) => markdown
      )
    ).toEqual(['disk version', 'my edits']);
  });
});
