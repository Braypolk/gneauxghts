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
    let inserted = '';
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
        insertMarkdown: (markdown) => {
          inserted = markdown;
          return { from: 0, to: 5, cursor: markdown.length };
        },
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
    expect(
      host.insertMarkdown({
        noteKey: 'draft:1',
        expectedDocumentRevision: 0,
        markdown: 'Replacement',
        target: 'selection'
      })
    ).toEqual({ status: 'inserted', from: 0, to: 5, cursor: 11 });
    expect(inserted).toBe('Replacement');

    await host.saveActiveDocument();
    await host.replaceActiveDocumentMarkdown('Next');

    expect(saved).toBe(true);
    expect(replaced).toBe('Next');
  });

  it('rejects insertion after the target document or its revision changes', () => {
    const document: NoteDraftState = {
      key: 'path:/vault/Current.md',
      title: 'Current',
      bodyMarkdown: 'Body',
      currentNoteId: 'current',
      currentNotePath: '/vault/Current.md',
      lastSavedTitle: 'Current',
      lastSavedMarkdown: 'Body',
      lastSavedNoteId: 'current',
      lastSavedPath: '/vault/Current.md',
      status: 'idle',
      operationRevision: 4,
      saveInvalidation: 0
    };
    let insertionCount = 0;
    const host = createNotepadFeatureHost({
      getActiveDocument: () => document,
      getActiveEditor: () => ({
        readSnapshot: () => null,
        readSelection: () => null,
        readCurrentBlock: () => null,
        replaceDocument: () => true,
        insertMarkdown: () => {
          insertionCount += 1;
          return { from: 0, to: 0, cursor: 1 };
        },
        addReadOnlyOverlay: () => ({ dispose: () => {} })
      }),
      focusActiveEditor: () => {},
      saveActiveDocument: async () => {},
      refreshActiveDocument: async () => {},
      replaceActiveDocumentMarkdown: async () => {}
    });

    expect(
      host.insertMarkdown({
        noteKey: 'path:/vault/Other.md',
        expectedDocumentRevision: 4,
        markdown: 'x'
      })
    ).toMatchObject({ status: 'target-changed', currentNoteKey: document.key });
    expect(
      host.insertMarkdown({
        noteKey: document.key,
        expectedDocumentRevision: 3,
        markdown: 'x'
      })
    ).toMatchObject({ status: 'target-changed', currentDocumentRevision: 4 });
    expect(insertionCount).toBe(0);
  });
});
