import { Text } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { describe, expect, it, vi } from 'vitest';
import { EditorDocumentRuntime } from '../editor/editorDocumentRuntime';
import { createPaneState } from '../editor/editorExtensions';
import { createRuntimePane } from '../editor/testSupport';
import { createDocumentEditingService } from './documentEditingService';
import { createNoteDraftState, createNotepadState } from '../state/noteStore';
import { createSessionSnapshot } from '../session/session';
import { dispatchDocumentOperation, documentHasCleanBuffer, documentToSessionSnapshot } from './documentState';
import { DocumentBody } from './documentBody';

function setup() {
  const markdown = 'Unchanged shared paragraph.\n\n'.repeat(2500);
  const document = createNoteDraftState(createSessionSnapshot({
    noteId: 'body-note', path: '/vault/body.md', title: 'Body', markdown
  }));
  const editing = createDocumentEditingService({
    state: createNotepadState(document), isApplyingProgrammaticUpdate: () => false,
    isTitleEditing: () => false, resetPaneCommandAfterBodyInput: (_pane, body) => { body.hasContent(); },
    clearRecentlyForgotten: () => {}, scheduleAutosave: () => {}, scheduleSearch: () => {}, scheduleRelated: () => {}
  });
  const runtime = new EditorDocumentRuntime(document.working.body);
  const change = vi.fn((body: typeof runtime.body) => {
    editing.recordUserEdit('source', document, body);
    documentHasCleanBuffer(document);
  });
  const first = createRuntimePane(runtime, markdown, markdown.length, change);
  const second = createRuntimePane(runtime, markdown, 0, change);
  second.setViewport(240, 12);
  const append = (pane: typeof first, text: string) => pane.view.dispatch({
    changes: { from: pane.readState().doc.length, insert: text },
    annotations: isolateHistory.of('full')
  });
  return { markdown, document, editing, runtime, change, first, second, append };
}

describe('immutable bodies through the document boundary', () => {
  it.each(['one\r\ntwo', 'one\rtwo'])('keeps root and pane offsets aligned for %j on creation and replacement', markdown => {
    const runtime = new EditorDocumentRuntime(DocumentBody.fromMarkdown(markdown));
    // Use the production pane constructor as well as the state-backed views.
    const initialPane = createPaneState(markdown, [], null);
    const first = createRuntimePane(runtime, markdown, initialPane.doc.length);
    const second = createRuntimePane(runtime, markdown, 0);
    expect(runtime.markdown).toBe(markdown); // Exact boundary bytes until editing.
    first.view.dispatch({ changes: { from: initialPane.doc.length, insert: '!' } });
    expect(runtime.markdown).toBe('one\ntwo!');
    expect(second.readState().doc.toString()).toBe('one\ntwo!');
    for (const flushHistory of [false, true]) {
      runtime.replaceBody(DocumentBody.fromMarkdown(markdown), { flushHistory, notifyBodyChange: false });
      const nextPane = createPaneState(markdown, [], null);
      expect(second.readState().doc.eq(nextPane.doc)).toBe(true);
      second.view.dispatch({ changes: { from: nextPane.doc.length, insert: '?' } });
      expect(runtime.markdown).toBe('one\ntwo?');
      expect(first.readState().doc.toString()).toBe('one\ntwo?');
    }
    runtime.adoptCommittedBody(DocumentBody.fromMarkdown(markdown));
    first.view.dispatch({ changes: { from: first.readState().doc.length, insert: '.' } });
    expect(runtime.markdown).toBe('one\ntwo.');
    runtime.destroy();
  });

  it('keeps live drafts, dirty state and split-pane undo current without string conversion', () => {
    const h = setup();
    const flatten = vi.spyOn(Text.prototype, 'toString');
    try {
      h.append(h.first, 'a');
      expect(h.document.working.body).toBe(h.runtime.body);
      expect(documentHasCleanBuffer(h.document)).toBe(false);
      h.first.view.dispatch({ selection: { anchor: 4 } });
      expect(h.second.readViewport()).toEqual({ scrollTop: 240, scrollLeft: 12 });
      expect(h.second.readState().selection.main.head).toBe(0);
      expect(h.change).toHaveBeenCalledTimes(1);
      expect(h.runtime.undo(h.second.controller.paneKey)).toBe(true);
      expect(documentHasCleanBuffer(h.document)).toBe(true);
      expect(h.runtime.redo(h.first.controller.paneKey)).toBe(true);
      expect(documentHasCleanBuffer(h.document)).toBe(false);
      expect(flatten).not.toHaveBeenCalled();
    } finally { flatten.mockRestore(); h.runtime.destroy(); }
  });

  it('pins an in-flight save, preserves newer edits, and retains content after all editors retire', async () => {
    const h = setup();
    const flatten = vi.spyOn(Text.prototype, 'toString');
    try {
      h.append(h.first, 'a');
      dispatchDocumentOperation(h.document, { type: 'start', operation: 'saving' });
      const capture = h.editing.captureSave(h.document);
      h.append(h.second, 'b');
      await Promise.resolve();
      expect(flatten).not.toHaveBeenCalled();
      expect(capture.body.toMarkdown()).toBe(h.markdown + 'a');
      expect(capture.body.toMarkdown()).toBe(h.markdown + 'a');
      expect(flatten).toHaveBeenCalledTimes(1);
      await h.editing.adoptSavedResult(capture, {
        noteId: 'body-note', path: '/vault/body.md', title: capture.title, markdown: capture.body.toMarkdown()
      });
      expect(h.document.savedBaseline?.content.body).toBe(capture.body);
      expect(h.document.working.body).toBe(h.runtime.body);
      expect(documentHasCleanBuffer(h.document)).toBe(false);
      expect(h.runtime.undo(h.first.controller.paneKey)).toBe(true);
      expect(documentHasCleanBuffer(h.document)).toBe(true);
      expect(h.runtime.redo(h.second.controller.paneKey)).toBe(true);
      expect(flatten).toHaveBeenCalledTimes(1);
      h.runtime.detachController(h.first.controller);
      h.runtime.detachController(h.second.controller);
      h.runtime.destroy();
      const snapshot = documentToSessionSnapshot(h.document);
      expect(snapshot.bodyMarkdown).toBe(h.markdown + 'ab');
      expect(snapshot.lastSavedMarkdown).toBe(h.markdown + 'a');
    } finally { flatten.mockRestore(); h.runtime.destroy(); }
  });

  it('does not advance the draft revision for a batch with identical net content', () => {
    const h = setup();
    const before = h.document.working.body;
    const revision = h.document.operation.revision;
    const a = h.first.readState().update({ changes: { from: 0, to: 1, insert: 'X' } });
    const b = a.state.update({ changes: { from: 0, to: 1, insert: 'U' } });
    const flatten = vi.spyOn(Text.prototype, 'toString');
    try {
      h.runtime.dispatchFromPane(h.first.controller, [a, b]);
      expect(h.document.working.body).toBe(before);
      expect(h.document.operation.revision).toBe(revision);
      expect(documentHasCleanBuffer(h.document)).toBe(true);
      expect(flatten).not.toHaveBeenCalled();
    } finally { flatten.mockRestore(); h.runtime.destroy(); }
  });
});
