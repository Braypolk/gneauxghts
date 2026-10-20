import { createRuntimePane as pane } from './testSupport';
import {
  Transaction,
  type TransactionSpec
} from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { describe, expect, it, vi } from 'vitest';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import {
  replaceEditorDocument,
  restoreCursorPosition
} from './editorViewController';
import { documentRegistry } from '../document/documentRegistry';
import {
  adoptCommittedDocument,
  createNoteDraftState,
  createNotepadState
} from '../state/noteStore';
import { updateDocumentBody, updateDocumentMarkdown } from '../document/documentState';

describe('EditorDocumentRuntime', () => {
  it.each([
    {
      name: 'successive insertions',
      specs: [
        { changes: { from: 1, insert: 'X' }, selection: { anchor: 2 } },
        { changes: { from: 5, insert: 'Y' }, selection: { anchor: 6 } }
      ],
      intermediate: 'aXbcd',
      expected: 'aXbcdY',
      sourceHead: 6,
      siblingHead: 5,
      undoHeads: [2, 1]
    },
    {
      name: 'same-length replacements',
      specs: [
        { changes: { from: 1, to: 2, insert: 'X' }, selection: { anchor: 2 } },
        { changes: { from: 2, to: 3, insert: 'Y' }, selection: { anchor: 3 } }
      ],
      intermediate: 'aXcd',
      expected: 'aXYd',
      sourceHead: 3,
      siblingHead: 4,
      undoHeads: [2, 1]
    },
    {
      name: 'edits interleaved with selection-only transactions',
      specs: [
        { selection: { anchor: 2 } },
        { changes: { from: 2, insert: 'X' }, selection: { anchor: 3 } },
        { selection: { anchor: 5 } },
        { changes: { from: 5, insert: 'Y' }, selection: { anchor: 6 } },
        { selection: { anchor: 1 } }
      ],
      intermediate: 'abXcd',
      expected: 'abXcdY',
      sourceHead: 1,
      siblingHead: 5,
      undoHeads: [5, 2]
    }
  ])('broadcasts a batch of $name with shared undo and local view state', ({
    specs, intermediate, expected, sourceHead, siblingHead, undoHeads
  }) => {
    const runtime = new EditorDocumentRuntime('abcd');
    const first = pane(runtime, 'abcd', 1);
    const second = pane(runtime, 'abcd', 4);
    second.setViewport(240, 12);
    let sourceState = first.readState();
    const transactions = specs.map((spec: TransactionSpec) => {
      const transaction = sourceState.update({
        ...spec,
        ...(spec.changes ? { annotations: isolateHistory.of('full') } : {})
      });
      sourceState = transaction.state;
      return transaction;
    });

    runtime.dispatchFromPane(first.controller, transactions);

    expect(runtime.markdown).toBe(expected);
    expect(first.readState().doc.toString()).toBe(expected);
    expect(second.readState().doc.toString()).toBe(expected);
    expect(first.readState().selection.main.head).toBe(sourceHead);
    expect(second.readState().selection.main.head).toBe(siblingHead);
    expect(second.readViewport()).toEqual({ scrollTop: 240, scrollLeft: 12 });
    expect(runtime.revision).toBe(1);
    expect(first.onBodyChange).toHaveBeenCalledExactlyOnceWith(runtime.body);
    expect(second.onBodyChange).not.toHaveBeenCalled();

    for (const [index, markdown] of [intermediate, 'abcd'].entries()) {
      expect(runtime.undo(second.controller.paneKey)).toBe(true);
      expect(runtime.markdown).toBe(markdown);
      expect(first.readState().doc.toString()).toBe(markdown);
      expect(second.readState().doc.toString()).toBe(markdown);
      expect(second.readState().selection.main.head).toBe(undoHeads[index]);
      expect(second.readViewport()).toEqual({ scrollTop: 240, scrollLeft: 12 });
    }
    expect(runtime.undo(second.controller.paneKey)).toBe(false);
    expect(second.onBodyChange).toHaveBeenCalledTimes(2);
    expect(first.onBodyChange).toHaveBeenCalledOnce();
    expect(runtime.redo(first.controller.paneKey)).toBe(true);
    expect(runtime.redo(first.controller.paneKey)).toBe(true);
    expect(runtime.markdown).toBe(expected);
    expect(first.readState().doc.toString()).toBe(expected);
    expect(second.readState().doc.toString()).toBe(expected);
    expect(first.onBodyChange).toHaveBeenCalledTimes(3);
  });



  it('retains two-pane selection, scroll, undo, and redo when a save assigns identity', () => {
    const document = createNoteDraftState();
    const state = createNotepadState(document, '/vault');
    const handle = document.handle;
    const registryEntry = documentRegistry.ensure(handle);
    const runtime = registryEntry.ensureResources({
      assetRootPath: null,
      storePastedImage: vi.fn()
    }).runtime;
    runtime.ensureMarkdown('abcd');
    updateDocumentMarkdown(document, 'abcd');
    const first = pane(runtime, 'abcd', 1, (markdown) => {
      updateDocumentBody(document, markdown);
    });
    const second = pane(runtime, 'abcd', 4, (markdown) => {
      updateDocumentBody(document, markdown);
    });
    second.setViewport(240, 12);
    runtime.dispatchFromPane(first.controller, [
      first.readState().update({
        changes: { from: 1, insert: 'X' },
        selection: { anchor: 2 }
      })
    ]);

    adoptCommittedDocument(state, document, {
      noteId: 'saved-id',
      title: 'Saved',
      markdown: 'aXbcd',
      path: '/vault/Saved.md'
    });

    expect(document.handle).toBe(handle);
    expect(documentRegistry.get(handle)).toBe(registryEntry);
    expect(registryEntry.resources()?.runtime).toBe(runtime);
    expect(first.readState().selection.main.head).toBe(2);
    expect(second.readState().selection.main.head).toBe(5);
    expect(second.readViewport()).toEqual({
      scrollTop: 240,
      scrollLeft: 12
    });
    expect(runtime.undo(second.controller.paneKey)).toBe(true);
    expect(runtime.markdown).toBe('abcd');
    expect(runtime.redo(first.controller.paneKey)).toBe(true);
    expect(runtime.markdown).toBe('aXbcd');
    documentRegistry.dispose(handle);
  });

  it('starts one fresh shared undo history across panes after Version Restore', () => {
    const runtime = new EditorDocumentRuntime('before restore');
    const first = pane(runtime, 'before restore', 3);
    const second = pane(runtime, 'before restore', 10);
    second.setViewport(240, 12);
    runtime.dispatchFromPane(first.controller, [
      first.readState().update({
        changes: { from: 14, insert: ' with local edit' }
      })
    ]);

    expect(runtime.adoptCommittedMarkdown('historical body')).toBe(true);
    expect(first.readState().doc.toString()).toBe('historical body');
    expect(second.readState().doc.toString()).toBe('historical body');
    expect(second.readViewport()).toEqual({
      scrollTop: 240,
      scrollLeft: 12
    });
    expect(runtime.undo(first.controller.paneKey)).toBe(false);
    expect(runtime.undo(second.controller.paneKey)).toBe(false);
    expect(runtime.markdown).toBe('historical body');

    runtime.dispatchFromPane(first.controller, [
      first.readState().update({ changes: { from: 15, insert: '!' } })
    ]);
    expect(runtime.undo(second.controller.paneKey)).toBe(true);
    expect(runtime.markdown).toBe('historical body');
  });

  it('clears undo on a committed properties-only replacement with an unchanged editor body', () => {
    const runtime = new EditorDocumentRuntime('body');
    const fixture = pane(runtime, 'body', 4);
    runtime.dispatchFromPane(fixture.controller, [
      fixture.readState().update({ changes: { from: 4, insert: ' edit' } })
    ]);
    runtime.adoptCommittedMarkdown('body edit');
    expect(runtime.markdown).toBe('body edit');
    expect(runtime.undo(fixture.controller.paneKey)).toBe(false);
    runtime.dispatchFromPane(fixture.controller, [
      fixture.readState().update({ changes: { from: 9, insert: '!' } })
    ]);
    expect(runtime.undo(fixture.controller.paneKey)).toBe(true);
    expect(runtime.markdown).toBe('body edit');
  });

  it('restores transient Markdown without notifying another pane edit', () => {
    const runtime = new EditorDocumentRuntime('before');
    const fixture = pane(runtime, 'before', 6);

    runtime.restoreTransientMarkdown('recovered draft');

    expect(runtime.markdown).toBe('recovered draft');
    expect(fixture.readState().doc.toString()).toBe(
      'recovered draft'
    );
    expect(fixture.onBodyChange).not.toHaveBeenCalled();
  });

  it('restores a reversed selection with a bounded fallback without changing the document', () => {
    const runtime = new EditorDocumentRuntime('tiny');
    const fixture = pane(runtime, 'tiny', 0);
    const revisionBefore = runtime.revision;

    expect(
      restoreCursorPosition(
        fixture.controller,
        { anchor: 99, head: 2 },
        { scrollIntoView: false }
      )
    ).toBe(true);

    expect(fixture.readState().selection.main.anchor).toBe(4);
    expect(fixture.readState().selection.main.head).toBe(2);
    expect(runtime.markdown).toBe('tiny');
    expect(runtime.revision).toBe(revisionBefore);
    expect(runtime.undo(fixture.controller.paneKey)).toBe(false);
  });

  it('replaces every attached pane with clamped selections and one callback', () => {
    const runtime = new EditorDocumentRuntime('long document');
    const first = pane(runtime, 'long document', 2);
    const second = pane(runtime, 'long document', 12);
    first.setViewport(80);
    second.setViewport(320);

    const changed = runtime.applyExternalSnapshot(
      {
        markdown: 'tiny',
        selection: { anchor: 3, head: 3 },
        revision: 1
      },
      first.controller
    );

    expect(changed).toBe(true);
    expect(first.readState().doc.toString()).toBe('tiny');
    expect(second.readState().doc.toString()).toBe('tiny');
    expect(first.readState().selection.main.head).toBe(3);
    expect(second.readState().selection.main.head).toBe(4);
    expect(first.readViewport().scrollTop).toBe(80);
    expect(second.readViewport().scrollTop).toBe(320);
    expect(first.onBodyChange).toHaveBeenCalledTimes(1);
    expect(second.onBodyChange).not.toHaveBeenCalled();
  });

  it('keeps different note runtimes isolated', () => {
    const leftRuntime = new EditorDocumentRuntime('left');
    const rightRuntime = new EditorDocumentRuntime('right');
    const left = pane(leftRuntime, 'left', 4);
    const right = pane(rightRuntime, 'right', 5);

    leftRuntime.dispatchFromPane(left.controller, [
      left.readState().update({ changes: { from: 4, insert: '!' } })
    ]);

    expect(leftRuntime.markdown).toBe('left!');
    expect(rightRuntime.markdown).toBe('right');
    expect(right.readState().doc.toString()).toBe('right');
  });

  it('applies a requested selection when replacement markdown is unchanged', () => {
    const runtime = new EditorDocumentRuntime('same');
    const fixture = pane(runtime, 'same', 0);

    expect(
      replaceEditorDocument(fixture.controller, 'same', {
        anchor: 4,
        head: 4
      })
    ).toBe(true);
    expect(fixture.readState().selection.main.anchor).toBe(4);
    expect(fixture.onBodyChange).not.toHaveBeenCalled();
  });
});
