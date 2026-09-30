import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentState,
  updateDocumentMarkdown
} from '$lib/features/notepad/document/documentState';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import { captureExternalSnapshotForTest } from '$lib/features/notepad/document/documentExternalSyncTestSupport';
import {
  createOpenDocumentTaskMutationHandler,
  sha256Text
} from './openDocumentTaskMutation';

function persistedDocument(markdown = '- [ ] Ship it') {
  const snapshot = {
    ...createEmptySessionSnapshot(),
    title: 'Tasks',
    bodyMarkdown: markdown,
    currentNoteId: 'note-1',
    currentNotePath: '/vault/Tasks.md',
    lastSavedTitle: 'Tasks',
    lastSavedMarkdown: markdown,
    lastSavedNoteId: 'note-1',
    lastSavedPath: '/vault/Tasks.md'
  };
  return createDocumentState(snapshot, 'document:tasks');
}

describe('open document task mutation', () => {
  it('uses the same lowercase SHA-256 contract as the backend', async () => {
    await expect(sha256Text('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('uses the canonical command when the document is not open or is clean', async () => {
    const clean = persistedDocument();
    const findReferencedDocument = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValue(clean);
    const prepare = vi.fn();
    const handler = createOpenDocumentTaskMutationHandler({
      findReferencedDocument,
      replaceMarkdown: vi.fn(),
      saveDocument: vi.fn(),
      prepare,
      hashMarkdown: async () => 'hash'
    });

    await expect(
      handler({
        kind: 'toggle',
        taskId: 'task-1',
        noteId: 'note-1',
        notePath: '/vault/Tasks.md'
      })
    ).resolves.toEqual({ status: 'use-canonical-command' });
    await expect(
      handler({
        kind: 'toggle',
        taskId: 'task-1',
        noteId: 'note-1',
        notePath: '/vault/Tasks.md'
      })
    ).resolves.toEqual({ status: 'use-canonical-command' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('prepares, applies, and saves a dirty document without writing behind it', async () => {
    const document = persistedDocument();
    updateDocumentMarkdown(document, '- [ ] Ship it\n\nLocal work');
    const replaceMarkdown = vi.fn(async (_document, markdown: string) => {
      updateDocumentMarkdown(document, markdown);
    });
    const saveDocument = vi.fn(async () => undefined);
    const prepare = vi.fn(async () => ({
      taskId: 'task-1',
      noteId: 'note-1',
      notePath: '/vault/Tasks.md',
      baseHash: 'hash',
      updatedEditorMarkdown: '- [x] Ship it\n\nLocal work'
    }));
    const handler = createOpenDocumentTaskMutationHandler({
      findReferencedDocument: () => document,
      replaceMarkdown,
      saveDocument,
      prepare,
      hashMarkdown: async () => 'hash'
    });

    await expect(
      handler({
        kind: 'toggle',
        taskId: 'task-1',
        noteId: 'note-1',
        notePath: '/vault/Tasks.md'
      })
    ).resolves.toEqual({ status: 'applied-to-open-document' });
    expect(prepare).toHaveBeenCalledWith({
      taskId: 'task-1',
      mutationKind: 'toggle',
      workingMarkdown: '- [ ] Ship it\n\nLocal work',
      bodyHash: 'hash'
    });
    expect(replaceMarkdown).toHaveBeenCalledOnce();
    expect(saveDocument).toHaveBeenCalledWith(document);
  });

  it('retries a stale prepare result against the latest document revision', async () => {
    const document = persistedDocument();
    updateDocumentMarkdown(document, '- [ ] Ship it\n\nVersion one');
    const prepare = vi
      .fn()
      .mockImplementationOnce(async () => {
        updateDocumentMarkdown(document, '- [ ] Ship it\n\nVersion two');
        return {
          taskId: 'task-1',
          noteId: 'note-1',
          notePath: '/vault/Tasks.md',
          baseHash: 'hash-one',
          updatedEditorMarkdown: '- [x] Ship it\n\nVersion one'
        };
      })
      .mockResolvedValueOnce({
        taskId: 'task-1',
        noteId: 'note-1',
        notePath: '/vault/Tasks.md',
        baseHash: 'hash-two',
        updatedEditorMarkdown: '- [x] Ship it\n\nVersion two'
      });
    const replaceMarkdown = vi.fn(async (_document, markdown: string) => {
      updateDocumentMarkdown(document, markdown);
    });
    const handler = createOpenDocumentTaskMutationHandler({
      findReferencedDocument: () => document,
      replaceMarkdown,
      saveDocument: vi.fn(async () => undefined),
      prepare,
      hashMarkdown: async (markdown) =>
        markdown.endsWith('one') ? 'hash-one' : 'hash-two'
    });

    await expect(
      handler({
        kind: 'toggle',
        taskId: 'task-1',
        noteId: 'note-1',
        notePath: '/vault/Tasks.md'
      })
    ).resolves.toEqual({ status: 'applied-to-open-document' });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(replaceMarkdown).toHaveBeenCalledWith(
      document,
      '- [x] Ship it\n\nVersion two'
    );
  });

  it('refuses to mutate a document with an unresolved external conflict', async () => {
    const document = persistedDocument();
    updateDocumentMarkdown(document, '- [ ] Ship it\n\nLocal work');
    captureExternalSnapshotForTest(
      document,
      {
        ...createEmptySessionSnapshot(),
        title: 'Tasks',
        bodyMarkdown: '- [x] Ship it',
        currentNoteId: 'note-1',
        currentNotePath: '/vault/Tasks.md'
      },
      'watcher'
    );
    const handler = createOpenDocumentTaskMutationHandler({
      findReferencedDocument: () => document,
      replaceMarkdown: vi.fn(),
      saveDocument: vi.fn(),
      prepare: vi.fn(),
      hashMarkdown: async () => 'hash'
    });

    await expect(
      handler({
        kind: 'delete',
        taskId: 'task-1',
        noteId: 'note-1',
        notePath: '/vault/Tasks.md'
      })
    ).rejects.toThrow('Resolve the note’s external-change conflict');
  });
});

describe('due dates through the open-document boundary', () => {
  it('forwards deadline edits and removal as typed mutation payloads before ordinary saves', async () => {
    for (const dueDate of ['2026-10-02', null]) {
      const document = persistedDocument();
      updateDocumentMarkdown(document, '- [ ] Ship it\nLocal work');
      const prepare = vi.fn(async () => ({ taskId: 'task-1', noteId: 'note-1', notePath: '/vault/Tasks.md', baseHash: 'hash', updatedEditorMarkdown: dueDate ? `- [ ] Ship it @due(${dueDate})\nLocal work` : '- [ ] Ship it\nLocal work' }));
      const saveDocument = vi.fn(async () => undefined);
      const handler = createOpenDocumentTaskMutationHandler({ findReferencedDocument: () => document, replaceMarkdown: async (_, markdown) => { updateDocumentMarkdown(document, markdown); }, saveDocument, prepare, hashMarkdown: async () => 'hash' });
      await expect(handler({ kind: 'setDueDate', taskId: 'task-1', noteId: 'note-1', notePath: '/vault/Tasks.md', dueDate })).resolves.toEqual({ status: 'applied-to-open-document' });
      expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ mutationKind: { setDueDate: { dueDate } }, workingMarkdown: '- [ ] Ship it\nLocal work' }));
      expect(saveDocument).toHaveBeenCalledWith(document);
    }
  });
});
