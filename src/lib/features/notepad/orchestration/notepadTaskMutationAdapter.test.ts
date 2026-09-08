import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentState,
  documentHasCleanBuffer,
  updateDocumentMarkdown,
  type DocumentHandle
} from '$lib/features/notepad/document/documentState';
import {
  bindNotepadStateToVault,
  createNotepadState
} from '$lib/features/notepad/state/noteStore';
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
    `document:${noteId}`
  );
}

describe('notepad task mutation adapter', () => {
  it('only resolves documents currently referenced by the workspace', () => {
    const referenced = document('note-1', '/vault/One.md');
    const unreferenced = document('note-2', '/vault/Two.md');
    const notes = {
      [referenced.handle]: referenced,
      [unreferenced.handle]: unreferenced
    };
    const deps = {
      listReferencedDocumentHandles: () => [
        referenced.handle
      ],
      getDocumentByHandle: (key: DocumentHandle) => notes[key] ?? null
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
    const state = createNotepadState(note);
    bindNotepadStateToVault(state, '/vault');
    const scheduleAutosave = vi.fn();
    const editing = createDocumentEditingService({
      state,
      isApplyingProgrammaticUpdate: () => false,
      shouldSuppressAutosave: () => false,
      isTitleEditing: () => false,
      resetPaneCommandAfterBodyInput: vi.fn(),
      clearRecentlyForgotten: vi.fn(),
      clearSelectedRelatedText: vi.fn(),
      scheduleAutosave,
      scheduleSearch: vi.fn(),
      scheduleRelated: vi.fn()
    });
    const saveNoteSession = vi.fn(
      async (
        title: string,
        markdown: string,
        currentPath: string | null
      ) => {
        trace.push(`editor-save:${markdown}`);
        return {
          title,
          markdown,
          noteId: 'system-trace-note',
          path: currentPath
        };
      }
    );
    const saveTaskNoteSession = vi.fn(
      async (
        title: string,
        markdown: string,
        currentPath: string | null
      ) => {
        trace.push(`save:${markdown}`);
        return {
          title,
          markdown,
          noteId: 'system-trace-note',
          path: currentPath
        };
      }
    );
    const persistence =
      createNotepadPersistenceController({
        getDocumentSession: () => note,
        saveNoteSession,
        saveTaskNoteSession,
        documentEditing: editing
      });
    const handler = createNotepadTaskMutationHandler({
      listReferencedDocumentHandles: () => [note.handle],
      getDocumentByHandle: () => note,
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
      expect(saveTaskNoteSession).toHaveBeenCalledWith(
        'Tasks',
        '- [x] Trace me\n\nUnsaved local context',
        path
      );
      expect(saveTaskNoteSession).toHaveBeenCalledTimes(1);
      expect(saveNoteSession).not.toHaveBeenCalled();
      expect(scheduleAutosave).not.toHaveBeenCalled();
      expect(documentHasCleanBuffer(note)).toBe(true);
      expect(note.savedBaseline?.content.markdown).toBe(
        '- [x] Trace me\n\nUnsaved local context'
      );
      expect(note.operation.kind).toBe('idle');
    } finally {
      documentRegistry.dispose(note.handle);
    }
  });
});
