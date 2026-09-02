import { describe, expect, it, vi } from 'vitest';
import {
  applySessionSnapshotToDocument,
  createDocumentState,
  documentHasCleanBuffer,
  updateDocumentMarkdown,
  type NoteKey
} from '$lib/features/notepad/document/documentState';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  createNotepadTaskMutationHandler,
  findReferencedDocumentByIdentity
} from './notepadTaskMutationAdapter';
import {
  createDocumentEditingService
} from '$lib/features/notepad/document/documentEditingService';
import {
  createNotepadPersistenceController
} from './persistenceController';
import {
  documentRegistry
} from '$lib/features/notepad/document/documentRegistry';

function document(
  noteId: string,
  path: string,
  markdown = '- [ ] Task'
) {
  return createDocumentState(
    {
      ...createEmptySessionSnapshot(),
      title: 'Tasks',
      bodyMarkdown: markdown,
      currentNoteId: noteId,
      currentNotePath: path,
      lastSavedTitle: 'Tasks',
      lastSavedMarkdown: markdown,
      lastSavedNoteId: noteId,
      lastSavedPath: path
    },
    `path:${path}`
  );
}

describe('notepad task mutation adapter', () => {
  it('only resolves documents currently referenced by the workspace', () => {
    const referenced = document('note-1', '/vault/One.md');
    const unreferenced = document('note-2', '/vault/Two.md');
    const notes = {
      [referenced.key]: referenced,
      [unreferenced.key]: unreferenced
    };
    const deps = {
      listReferencedNoteKeys: () => [
        referenced.key
      ],
      getNoteByKey: (key: NoteKey) => notes[key] ?? null
    };

    expect(
      findReferencedDocumentByIdentity(
        deps,
        'note-1',
        '/stale/path.md'
      )
    ).toBe(referenced);
    expect(
      findReferencedDocumentByIdentity(
        deps,
        'stale-id',
        '/vault/One.md'
      )
    ).toBe(referenced);
    expect(
      findReferencedDocumentByIdentity(
        deps,
        'note-2',
        '/vault/Two.md'
      )
    ).toBeNull();
  });

  it('replaces the dirty shared document in place and crosses the normal save boundary', async () => {
    const note = document('note-1', '/vault/One.md');
    updateDocumentMarkdown(note, '- [ ] Task\n\nLocal edit');
    const replaceDocumentContentInPlace = vi.fn(
      async () => undefined
    );
    const replaceMarkdown = vi.fn(
      async (
        target,
        markdown: string,
        applyToRuntime: (markdown: string) => Promise<void>
      ) => {
        updateDocumentMarkdown(target, markdown);
        await applyToRuntime(markdown);
      }
    );
    const enqueueSave = vi.fn(async () => undefined);
    const attributeTaskActionSave = vi.fn();
    const handler = createNotepadTaskMutationHandler({
      listReferencedNoteKeys: () => [note.key],
      getNoteByKey: () => note,
      replaceMarkdown,
      replaceDocumentContentInPlace,
      enqueueSave,
      attributeTaskActionSave,
      hashMarkdown: async () => 'body-hash',
      prepare: async () => ({
        taskId: 'task-1',
        noteId: 'note-1',
        notePath: '/vault/One.md',
        baseHash: 'body-hash',
        updatedEditorMarkdown: '- [x] Task\n\nLocal edit'
      })
    });

    await expect(
      handler({
        kind: 'toggle',
        taskId: 'task-1',
        noteId: 'note-1',
        notePath: '/vault/One.md'
      })
    ).resolves.toEqual({
      status: 'applied-to-open-document'
    });

    expect(replaceMarkdown).toHaveBeenCalledWith(
      note,
      '- [x] Task\n\nLocal edit',
      expect.any(Function),
      { autosave: false }
    );
    expect(
      replaceDocumentContentInPlace
    ).toHaveBeenCalledWith(
      note,
      '- [x] Task\n\nLocal edit'
    );
    expect(attributeTaskActionSave).toHaveBeenCalledWith(
      note,
      '- [x] Task\n\nLocal edit'
    );
    expect(enqueueSave).toHaveBeenCalledWith(note);
  });

  it('traces a dirty task mutation through editing and the real document save boundary', async () => {
    const path = '/vault/System Trace.md';
    const note = document(
      'system-trace-note',
      path,
      '- [ ] Trace me'
    );
    updateDocumentMarkdown(
      note,
      '- [ ] Trace me\n\nUnsaved local context'
    );
    const trace: string[] = [];
    const editing = createDocumentEditingService({
      isApplyingProgrammaticUpdate: () => false,
      shouldSuppressAutosave: () => false,
      resetPaneCommandAfterBodyInput: vi.fn(),
      clearRecentlyForgotten: vi.fn(),
      scheduleAutosave: vi.fn(),
      scheduleSearch: vi.fn(),
      scheduleRelated: vi.fn()
    });
    const saveNoteSession = vi.fn(
      async (
        title: string,
        markdown: string,
        currentPath: string | null
      ) => {
        trace.push(`save:${markdown}`);
        return {
          ...createEmptySessionSnapshot(),
          title,
          bodyMarkdown: markdown,
          currentNoteId: 'system-trace-note',
          currentNotePath: currentPath,
          lastSavedTitle: title,
          lastSavedMarkdown: markdown,
          lastSavedNoteId: 'system-trace-note',
          lastSavedPath: currentPath
        };
      }
    );
    const persistence =
      createNotepadPersistenceController({
        getDocumentSession: () => note,
        saveNoteSession,
        saveTaskNoteSession: saveNoteSession,
        rekeyNoteWithRuntime: (current) => current,
        applySavedSnapshot: (
          current,
          saved,
          { preserveDraft }
        ) => {
          applySessionSnapshotToDocument(current, saved, {
            preserveWorking: preserveDraft
          });
        }
      });
    const handler = createNotepadTaskMutationHandler({
      listReferencedNoteKeys: () => [note.key],
      getNoteByKey: () => note,
      replaceMarkdown: (
        target,
        markdown,
        applyToRuntime,
        options
      ) =>
        editing.replaceMarkdown(
          target,
          markdown,
          applyToRuntime,
          options
        ),
      replaceDocumentContentInPlace: async (
        _target,
        markdown
      ) => {
        trace.push(`runtime:${markdown}`);
      },
      enqueueSave: persistence.enqueueSave,
      attributeTaskActionSave:
        persistence.attributeTaskActionSave,
      hashMarkdown: async () => 'trace-hash',
      prepare: async ({ workingMarkdown }) => {
        trace.push(`prepare:${workingMarkdown}`);
        return {
          taskId: 'task-trace',
          noteId: 'system-trace-note',
          notePath: path,
          baseHash: 'trace-hash',
          updatedEditorMarkdown:
            '- [x] Trace me\n\nUnsaved local context'
        };
      }
    });

    try {
      await expect(
        handler({
          kind: 'toggle',
          taskId: 'task-trace',
          noteId: 'system-trace-note',
          notePath: path
        })
      ).resolves.toEqual({
        status: 'applied-to-open-document'
      });

      expect(trace).toEqual([
        'prepare:- [ ] Trace me\n\nUnsaved local context',
        'runtime:- [x] Trace me\n\nUnsaved local context',
        'save:- [x] Trace me\n\nUnsaved local context'
      ]);
      expect(saveNoteSession).toHaveBeenCalledWith(
        'Tasks',
        '- [x] Trace me\n\nUnsaved local context',
        path
      );
      expect(documentHasCleanBuffer(note)).toBe(true);
      expect(note.savedBaseline?.content.markdown).toBe(
        '- [x] Trace me\n\nUnsaved local context'
      );
      expect(note.operation.kind).toBe('idle');
    } finally {
      documentRegistry.dispose(note.key);
    }
  });
});
