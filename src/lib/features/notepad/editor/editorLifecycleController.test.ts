import { DocumentBody } from '../document/documentBody';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the onBodyChange callback the controller installs, and stub the
// rest of the heavy CodeMirror editor stack so the lifecycle controller can run
// without a real DOM/editor.
let capturedOnBodyChange: ((body: DocumentBody) => void) | null = null;

vi.mock('./editorPresentation', async (importOriginal) => ({
  ...await importOriginal<typeof import('./editorPresentation')>(),
  settleEditorPresentation: vi.fn(async () => true)
}));

vi.mock('#lib/features/notepad/editor/editor.js', () => ({
  createEditor: vi.fn(async ({ onBodyChange }) => {
    capturedOnBodyChange = onBodyChange;
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

vi.mock('#lib/features/notepad/editor/slashMenuBridge.js', () => ({
  bindSlashMenuViewToPane: vi.fn(),
  unbindSlashMenuView: vi.fn()
}));

vi.mock('#lib/features/notepad/editor/selectionMenuBridge.js', () => ({
  bindSelectionMenuViewToPane: vi.fn(),
  unbindSelectionMenuView: vi.fn()
}));

vi.mock('#lib/features/notepad/navigation/navigation.js', () => ({
  waitForEditorPaint: vi.fn(async () => {})
}));

import { createEditorLifecycleController } from './editorLifecycleController';
import { settleEditorPresentation } from './editorPresentation';
import { createEmptySessionSnapshot } from '#lib/features/notepad/session/session.js';
import {
  createEditor,
  readCursorPosition,
  replaceEditorContent,
  restoreCursorPosition
} from '#lib/features/notepad/editor/editor.js';
import { loadEditorViewState, saveEditorViewState } from './editorViewState';
import {
  createNoteDraftState,
  type NoteDraftState
} from '#lib/features/notepad/state/noteStore.js';

describe('editorLifecycleController onBodyChange routing', () => {
  beforeEach(() => {
    capturedOnBodyChange = null;
    vi.clearAllMocks();
  });

  it('routes body edits to the live pane document after navigation', async () => {
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
      getEditorShell: () => null,
      getEditorRoot: () => ({}) as never,
      // The pane-scoped accessor always returns the *current* note object.
      getDocumentSession: () => liveDocument,
      setIsEditorReady: () => {},
      setIsApplyingProgrammaticUpdate: () => {},
      handleEditorBodyChange: (_paneId, document, nextMarkdown) => {
        received.push({ key: document.handle, markdown: nextMarkdown.toMarkdown() });
      },
      getSharedEditorResources: () => ({}) as never,
      getViewCallbacks: () => ({}) as never,
      closeTransientUi: () => {}
    });

    await controller.createEditor('');
    expect(capturedOnBodyChange).toBeTypeOf('function');

    // Navigation selects another live document. Save identity adoption retains
    // the original handle and is covered by EditorDocumentRuntime tests.
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

    // The user types after navigation.
    capturedOnBodyChange!(DocumentBody.fromMarkdown('body text'));

    // The callback resolves the current pane document at invocation.
    expect(received).toEqual([{ key: liveDocument.handle, markdown: 'body text' }]);
    expect(liveDocument.handle).not.toBe(draftDocument.handle);
  });

  it('does not reset a shared runtime when a pane remounts the same document', async () => {
    const liveDocument = createNoteDraftState({
      title: 'Shared',
      bodyMarkdown: 'already live',
      currentNoteId: 'shared-id',
      currentNotePath: '/vault/Shared.md',
      lastSavedTitle: 'Shared',
      lastSavedMarkdown: 'already live',
      lastSavedNoteId: 'shared-id',
      lastSavedPath: '/vault/Shared.md'
    });
    const editor = {
      runtime: { markdown: 'already live' },
      view: {}
    } as never;
    const closeTransientUi = vi.fn();
    const controller = createEditorLifecycleController({
      getController: () => editor,
      getPaneId: () => 'right',
      setController: () => {},
      getEditorShell: () => null,
      getEditorRoot: () => null,
      getDocumentSession: () => liveDocument,
      setIsEditorReady: () => {},
      setIsApplyingProgrammaticUpdate: () => {},
      handleEditorBodyChange: () => {},
      getSharedEditorResources: () => ({}) as never,
      getViewCallbacks: () => ({}) as never,
      closeTransientUi
    });

    await controller.replaceEditorContentInPlaceForDocument(
      'already live',
      liveDocument
    );

    expect(replaceEditorContent).not.toHaveBeenCalled();
    expect(closeTransientUi).toHaveBeenCalledOnce();
    expect(restoreCursorPosition).toHaveBeenCalledWith(
      editor,
      { anchor: 0, head: 0 },
      { scrollIntoView: true }
    );
  });
});

describe('editor presentation readiness', () => {
  function harness() {
    let document = createNoteDraftState({ ...createEmptySessionSnapshot(), title: 'First', bodyMarkdown: 'body' });
    let editor: import('./types').EditorController | null = null;
    let ready = false;
    const lifecycle = createEditorLifecycleController({
      getController: () => editor,
      getPaneId: () => 'primary',
      setController: value => { editor = value; },
      getEditorShell: () => null,
      getEditorRoot: () => ({}) as never,
      getDocumentSession: () => document,
      setIsEditorReady: value => { ready = value; },
      setIsApplyingProgrammaticUpdate: () => {},
      handleEditorBodyChange: () => {},
      getSharedEditorResources: () => ({}) as never,
      getViewCallbacks: () => ({}) as never,
      closeTransientUi: () => {}
    });
    return {
      lifecycle,
      get document() { return document; },
      get ready() { return ready; },
      switchDocument() {
        document = createNoteDraftState({ ...createEmptySessionSnapshot(), title: 'Second', bodyMarkdown: 'other' });
      }
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it('stays loading until formatting and measurement finish', async () => {
    let finish!: (settled: boolean) => void;
    vi.mocked(settleEditorPresentation).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const h = harness();
    await h.lifecycle.createEditor('body');
    const presentation = h.lifecycle.finishEditorPresentation(h.document);
    expect(h.ready).toBe(false);
    finish(true);
    await expect(presentation).resolves.toBe(true);
    expect(h.ready).toBe(true);
  });

  it('does not reveal a document that became obsolete while measuring', async () => {
    let finish!: (settled: boolean) => void;
    vi.mocked(settleEditorPresentation).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const h = harness();
    await h.lifecycle.createEditor('body');
    const presentation = h.lifecycle.finishEditorPresentation(h.document);
    h.switchDocument();
    finish(true);
    await expect(presentation).resolves.toBe(false);
    expect(h.ready).toBe(false);
  });

  it('restores keyboard focus after a recreated editor becomes visible', async () => {
    const h = harness();
    const focus = vi.fn(() => { expect(h.ready).toBe(true); });
    vi.mocked(createEditor)
      .mockResolvedValueOnce({ view: { hasFocus: true } } as never)
      .mockResolvedValueOnce({ view: { focus } } as never);
    await h.lifecycle.createEditor('body');
    await h.lifecycle.finishEditorPresentation(h.document);

    await h.lifecycle.replaceEditorContent('replacement', { restoreCursor: true });

    expect(focus).toHaveBeenCalledOnce();
  });

  it('keeps a recreated editor hidden if its pane is disposed while settling', async () => {
    const h = harness();
    await h.lifecycle.createEditor('body');
    await h.lifecycle.finishEditorPresentation(h.document);
    let finish!: (settled: boolean) => void;
    let entered!: () => void;
    const measuring = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(settleEditorPresentation).mockImplementationOnce(() => {
      entered();
      return new Promise(resolve => { finish = resolve; });
    });
    let current = true;
    const replacement = h.lifecycle.replaceEditorContent('replacement', { isCurrent: () => current });
    await measuring;
    current = false;
    finish(true);
    await replacement;
    expect(h.ready).toBe(false);
  });
});

describe('editorLifecycleController reading-position persistence', () => {
  const notePath = '/vault/Long.md';
  let storage: Map<string, string>;

  function scrollerStub(scrollTop: number) {
    return {
      scrollTop,
      scrollHeight: 4000,
      clientHeight: 800,
      getBoundingClientRect: () => ({ top: 0 })
    };
  }

  function harness(scrollTop: number) {
    const scrollDOM = scrollerStub(scrollTop);
    const editor = {
      runtime: { markdown: 'body' },
      view: { scrollDOM, requestMeasure: vi.fn() }
    } as never;
    const document = createNoteDraftState({
      title: 'Long',
      bodyMarkdown: 'body',
      currentNoteId: 'long-id',
      currentNotePath: notePath,
      lastSavedTitle: 'Long',
      lastSavedMarkdown: 'body',
      lastSavedNoteId: 'long-id',
      lastSavedPath: notePath
    });
    const controller = createEditorLifecycleController({
      getController: () => editor,
      getPaneId: () => 'primary',
      setController: () => {},
      getEditorShell: () => null,
      getEditorRoot: () => null,
      getDocumentSession: () => document,
      setIsEditorReady: () => {},
      setIsApplyingProgrammaticUpdate: () => {},
      handleEditorBodyChange: () => {},
      getSharedEditorResources: () => ({}) as never,
      getViewCallbacks: () => ({}) as never,
      closeTransientUi: () => {}
    });

    return { controller, document, editor, scrollDOM };
  }

  beforeEach(() => {
    storage = new Map<string, string>();
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('saves how far the reader had scrolled alongside the cursor', () => {
    vi.mocked(readCursorPosition).mockReturnValue({ anchor: 12, head: 12 });
    const h = harness(1850);

    h.controller.saveCursorPositionForDocument(h.document);

    expect(loadEditorViewState(notePath, 'primary', 'long-id')).toEqual({
      anchor: 12,
      head: 12,
      scrollTop: 1850
    });
  });

  it('reopens at the saved scroll offset rather than snapping to the cursor', () => {
    saveEditorViewState(
      notePath,
      { anchor: 12, head: 12, scrollTop: 1850 },
      'primary',
      'long-id'
    );
    vi.mocked(restoreCursorPosition).mockReturnValue(true);
    const h = harness(0);

    h.controller.restoreCursorPositionForDocument(h.document);

    expect(restoreCursorPosition).toHaveBeenCalledWith(
      h.editor,
      { anchor: 12, head: 12, scrollTop: 1850 },
      { scrollIntoView: false }
    );
    expect(h.scrollDOM.scrollTop).toBe(1850);
  });

  it('restores an explicit reversed selection and scroll snapshot', async () => {
    vi.mocked(restoreCursorPosition).mockReturnValue(true);
    const h = harness(0);
    const viewState = { anchor: 18, head: 7, scrollTop: 1850 };

    await expect(
      h.controller.restoreEditorViewStateForDocument(h.document, viewState)
    ).resolves.toBe(true);

    expect(restoreCursorPosition).toHaveBeenCalledWith(h.editor, viewState, {
      scrollIntoView: false
    });
    expect(h.scrollDOM.scrollTop).toBe(1850);
  });

  it('does not deadlock restoration when the native frame callback is suspended', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.mocked(restoreCursorPosition).mockReturnValue(true);
    const h = harness(0);
    let settled = false;

    void h.controller
      .restoreEditorViewStateForDocument(h.document, {
        anchor: 18,
        head: 7,
        scrollTop: 1850
      })
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(300);

    expect(settled).toBe(true);
    expect(h.scrollDOM.scrollTop).toBe(1850);
  });

  it('finishes same-runtime scroll restoration before a subsequent navigation owns the viewport', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    saveEditorViewState(notePath, { anchor: 0, head: 0, scrollTop: 0 }, 'primary', 'long-id');
    const h = harness(0);
    const opened = h.controller.replaceEditorContentInPlaceForDocument('body', h.document)
      .then(() => { h.scrollDOM.scrollTop = 2000; });
    await vi.runAllTimersAsync();
    await opened;
    expect(h.scrollDOM.scrollTop).toBe(2000);
  });

  it('still reveals the cursor for notes saved before scroll was tracked', () => {
    saveEditorViewState(notePath, { anchor: 12, head: 12 }, 'primary', 'long-id');
    vi.mocked(restoreCursorPosition).mockReturnValue(true);
    const h = harness(0);

    h.controller.restoreCursorPositionForDocument(h.document);

    expect(restoreCursorPosition).toHaveBeenCalledWith(
      h.editor,
      { anchor: 12, head: 12 },
      { scrollIntoView: true }
    );
    expect(h.scrollDOM.scrollTop).toBe(0);
  });

  it('clamps a saved offset that no longer fits a shortened note', () => {
    saveEditorViewState(
      notePath,
      { anchor: 0, head: 0, scrollTop: 99_000 },
      'primary',
      'long-id'
    );
    vi.mocked(restoreCursorPosition).mockReturnValue(true);
    const h = harness(0);

    h.controller.restoreCursorPositionForDocument(h.document);

    expect(h.scrollDOM.scrollTop).toBe(4000 - 800);
  });
});
