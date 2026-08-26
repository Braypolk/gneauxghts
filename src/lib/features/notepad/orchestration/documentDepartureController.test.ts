import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  createNoteDraftState
} from '$lib/features/notepad/state/noteStore';
import {
  loadEditorViewState,
  saveEditorViewState
} from '$lib/features/notepad/editor/editorViewState';
import { createDocumentDepartureController } from './documentDepartureController';

describe('document departure controller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists before saving the cursor against the authoritative document', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    });
    const draft = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Draft',
      bodyMarkdown: 'Body'
    });
    const saved = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Draft',
      bodyMarkdown: 'Body',
      currentNoteId: 'note-1',
      currentNotePath: '/vault/Draft.md'
    });
    const events: string[] = [];
    let paneDocument = draft;
    const controller = createDocumentDepartureController({
      getPaneDocument: () => paneDocument,
      flushAllPendingCursorSaves: () => {
        events.push('flush-cursor');
      },
      cancelPendingAutosave: () => {
        events.push('cancel-autosave');
      },
      getNoteSaveQueue: async () => {
        events.push('await-save-queue');
      },
      enqueueSave: async () => {
        events.push('persist');
        paneDocument = saved;
      },
      saveCursorPositionForPane: async (paneId, document) => {
        expect(paneId).toBe('pane-1');
        expect(document).toBe(saved);
        if (document.identity.kind !== 'persisted') {
          throw new Error('Expected a persisted identity');
        }
        saveEditorViewState(
          document.identity.path,
          { anchor: 9, head: 9 },
          'pane-1',
          document.identity.noteId
        );
        events.push('save-authoritative-cursor');
      },
      clearLastOpenedNote: async () => {
        events.push('clear-last-opened');
      }
    });

    await expect(
      controller.prepare('pane-1', draft, {
        clearLastOpened: true
      })
    ).resolves.toBe(saved);
    expect(events).toEqual([
      'flush-cursor',
      'cancel-autosave',
      'await-save-queue',
      'persist',
      'save-authoritative-cursor',
      'clear-last-opened'
    ]);
    expect(
      loadEditorViewState(
        '/vault/Draft.md',
        'pane-1',
        'note-1'
      )
    ).toEqual({ anchor: 9, head: 9 });
  });
});
