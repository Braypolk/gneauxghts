import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the onMarkdownChange callback the controller installs, and stub the
// rest of the heavy CodeMirror editor stack so the lifecycle controller can run
// without a real DOM/editor.
let capturedOnMarkdownChange: ((markdown: string) => void) | null = null;

vi.mock('$lib/features/notepad/editor/editor', () => ({
  createEditor: vi.fn(async ({ onMarkdownChange }) => {
    capturedOnMarkdownChange = onMarkdownChange;
    return { view: {} };
  }),
  destroyEditor: vi.fn(async () => null),
  prepareEditor: vi.fn(async () => true),
  readCursorPosition: vi.fn(() => null),
  readEditorState: vi.fn(() => null),
  replaceEditorContent: vi.fn(),
  replaceEditorDocument: vi.fn(),
  alignEditorScrollToSelection: vi.fn(),
  restoreCursorPosition: vi.fn(() => false),
  swapEditorRuntime: vi.fn(() => true)
}));

vi.mock('$lib/features/notepad/editor/slashMenuBridge', () => ({
  bindSlashMenuViewToPane: vi.fn(),
  unbindSlashMenuView: vi.fn()
}));

vi.mock('$lib/features/notepad/editor/selectionMenuBridge', () => ({
  bindSelectionMenuViewToPane: vi.fn(),
  unbindSelectionMenuView: vi.fn()
}));

vi.mock('$lib/features/notepad/navigation/navigation', () => ({
  waitForEditorPaint: vi.fn(async () => {})
}));

import { createEditorLifecycleController } from './editorLifecycleController';
import {
  createNoteDraftState,
  type NoteDraftState
} from '$lib/features/notepad/state/noteStore';

describe('editorLifecycleController onMarkdownChange routing', () => {
  beforeEach(() => {
    capturedOnMarkdownChange = null;
  });

  it('routes body edits to the live pane note after a save rekeys the draft', async () => {
    // The pane starts on a brand-new draft note (no path yet).
    let liveDocument: NoteDraftState = createNoteDraftState({
      title: 'Foo',
      bodyMarkdown: '',
      currentNoteId: null,
      currentNotePath: null,
      lastSavedTitle: '',
      lastSavedMarkdown: '',
      lastSavedNoteId: null,
      lastSavedPath: null
    });
    const draftDocument = liveDocument;

    const received: Array<{ key: string; markdown: string }> = [];

    const controller = createEditorLifecycleController({
      getController: () => ({ view: {} }) as never,
      getPaneId: () => 'primary',
      setController: () => {},
      getShellElement: () => null,
      getEditorShell: () => null,
      getEditorRoot: () => ({}) as never,
      // The pane-scoped accessor always returns the *current* note object.
      getDocumentSession: () => liveDocument,
      getSharedEditorState: () => null,
      setSharedEditorState: () => {},
      setIsEditorReady: () => {},
      setIsApplyingExternalContent: () => {},
      handleEditorMarkdownChange: (_paneId, document, nextMarkdown) => {
        received.push({ key: document.key, markdown: nextMarkdown });
      },
      getSharedEditorResources: () => ({}) as never,
      getViewCallbacks: () => ({}) as never,
      closeTransientUi: () => {}
    });

    await controller.createEditor('');
    expect(capturedOnMarkdownChange).toBeTypeOf('function');

    // A save rekeys the draft to its persisted path, replacing the pane's note
    // object (the collision branch of rekeyNote returns a *different* object).
    liveDocument = createNoteDraftState({
      title: 'Foo',
      bodyMarkdown: '',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/Foo.md',
      lastSavedTitle: 'Foo',
      lastSavedMarkdown: '',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/Foo.md'
    });

    // The user keeps typing the body after the rekey.
    capturedOnMarkdownChange!('body text');

    // The edit must land on the persisted note, not the orphaned draft —
    // otherwise the body is saved as a separate file.
    expect(received).toEqual([{ key: liveDocument.key, markdown: 'body text' }]);
    expect(liveDocument.key).not.toBe(draftDocument.key);
  });
});
