import { describe, expect, it } from 'vitest';
import { createNotepadFeatureHost, snapshotDocument } from './host';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

describe('snapshotDocument', () => {
  it('returns a detached document snapshot for feature consumers', () => {
    const document: NoteDraftState = {
      key: 'path:/vault/Test.md',
      title: 'Test',
      bodyMarkdown: 'Body',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/Test.md',
      lastSavedTitle: 'Saved',
      lastSavedMarkdown: 'Saved body',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/Test.md',
      status: 'idle',
      operationRevision: 3,
      saveInvalidation: 1
    };

    const snapshot = snapshotDocument(document);
    document.title = 'Mutated';
    document.bodyMarkdown = 'Changed';

    expect(snapshot).toEqual({
      key: 'path:/vault/Test.md',
      title: 'Test',
      bodyMarkdown: 'Body',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/Test.md',
      lastSavedTitle: 'Saved',
      lastSavedMarkdown: 'Saved body',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/Test.md',
      operationRevision: 3
    });
  });
});

describe('createNotepadFeatureHost', () => {
  it('adapts active document and editor capabilities without exposing runtime state', async () => {
    const document: NoteDraftState = {
      key: 'draft:1',
      title: 'Draft',
      bodyMarkdown: 'Hello world',
      currentNoteId: null,
      currentNotePath: null,
      lastSavedTitle: '',
      lastSavedMarkdown: '',
      lastSavedNoteId: null,
      lastSavedPath: null,
      status: 'idle',
      operationRevision: 0,
      saveInvalidation: 0
    };
    let saved = false;
    let replaced = '';
    const host = createNotepadFeatureHost({
      getActiveDocument: () => document,
      getActiveEditor: () => ({
        readSnapshot: () => ({
          markdown: document.bodyMarkdown,
          selection: { anchor: 0, head: 5 },
          revision: 1
        }),
        readSelection: () => ({ anchor: 0, head: 5, selectedText: 'Hello' }),
        readCurrentBlock: () => null,
        replaceDocument: () => true,
        addReadOnlyOverlay: () => ({ dispose: () => {} })
      }),
      focusActiveEditor: () => {},
      saveActiveDocument: async () => {
        saved = true;
      },
      refreshActiveDocument: async () => {},
      replaceActiveDocumentMarkdown: async (markdown) => {
        replaced = markdown;
      }
    });

    expect(host.getActiveDocumentSnapshot().bodyMarkdown).toBe('Hello world');
    expect(host.getActiveSelectionSnapshot()).toEqual({
      anchor: 0,
      head: 5,
      selectedText: 'Hello'
    });

    await host.saveActiveDocument();
    await host.replaceActiveDocumentMarkdown('Next');

    expect(saved).toBe(true);
    expect(replaced).toBe('Next');
  });
});
