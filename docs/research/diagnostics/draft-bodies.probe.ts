import { DocumentBody } from '../document/documentBody';
// Current immutable-body diagnostic. Copy into editor/draftBodiesDiagnostic.temporary.test.ts to run.
import { expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { createRuntimePane } from './testSupport';
import { createDocumentEditingService } from '../document/documentEditingService';
import { createNoteDraftState, createNotepadState } from '../state/noteStore';
import { createSessionSnapshot } from '../session/session';
import { documentHasCleanBuffer, updateDocumentBody } from '../document/documentState';
import { imageState } from '../images/imageState';

const section = 'Plain note text with enough ordinary prose to resemble a multiline Markdown note.\n\n';
let sink = 0;
const count = 25;
function measure(f: (i: number) => void) {
  f(0); f(1); f(2); f(3);
  const samples: number[] = [];
  for (let i = 4; i < count; i++) {
    const start = performance.now(); f(i); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { median: +samples[10].toFixed(4), p95: +samples[19].toFixed(4) };
}
function fixture(chars: number) { return section.repeat(Math.ceil(chars / section.length)).slice(0, chars); }

it('counts and times real runtime notifications with a real editing service', () => {
  const prototype = Text.prototype;
  const original = prototype.toString;
  let captures = 0, captureMs = 0;
  prototype.toString = function () {
    const start = performance.now();
    const result = original.call(this);
    captures++; captureMs += performance.now() - start;
    return result;
  };
  try {
    for (const size of [50_000, 500_000, 2_000_000]) for (const paneCount of [1, 2]) {
      const markdown = fixture(size);
      const note = createNoteDraftState(createSessionSnapshot({ noteId: 'diag', path: '/diag.md', title: 'Title', markdown }));
      const state = createNotepadState(note);
      const editing = createDocumentEditingService({
        state, isApplyingProgrammaticUpdate: () => false, isTitleEditing: () => false,
        resetPaneCommandAfterBodyInput: () => {}, clearRecentlyForgotten: () => {},
        scheduleAutosave: () => {}, scheduleSearch: () => {}, scheduleRelated: () => {}
      });
      const runtime = new EditorDocumentRuntime(note.working.body);
      let notifications = 0;
      const changed = (body: DocumentBody) => { notifications++; editing.recordUserEdit('source', note, body); sink += Number(documentHasCleanBuffer(note)); };
      const pane = createRuntimePane(runtime, markdown, markdown.length, changed);
      const sibling = paneCount === 2 ? createRuntimePane(runtime, markdown, 0, changed) : null;
      const report: Record<string, unknown> = { size, paneCount };
      for (const kind of ['insert', 'replace', 'selection'] as const) {
        if (kind === 'replace') {
          runtime.replaceBody(note.savedBaseline!.content.body, { flushHistory: true, notifyBodyChange: false });
          updateDocumentBody(note, note.savedBaseline!.content.body);
        }
        captures = 0; captureMs = 0; notifications = 0;
        const timing = measure(i => {
          const doc = pane.readState().doc;
          pane.view.dispatch(kind === 'insert'
            ? { changes: { from: doc.length, insert: 'x' } }
            : kind === 'replace'
              ? { changes: { from: doc.length - 3, to: doc.length - 2, insert: String.fromCharCode(65 + i) } }
              : { selection: { anchor: doc.length - i } });
        });
        report[kind] = { timing, toStringCalls: captures, notifications, toStringTotalMs: +captureMs.toFixed(3) };
      }
      const capturesBefore = captures;
      expect(capturesBefore).toBe(0);
      for (let i = 0; i < 10; i++) sink += runtime.markdown.length;
      expect(captures).toBe(capturesBefore + 1);
      expect(sibling?.readState().doc.length ?? pane.readState().doc.length).toBe(pane.readState().doc.length);
      console.log('GNEAUXGHTS_BODY_RUNTIME', JSON.stringify(report));
      runtime.destroy();
    }
  } finally { prototype.toString = original; }
});

it('isolates image inventory as another full-body consumer', () => {
  const original = Text.prototype.toString;
  let captures = 0;
  Text.prototype.toString = function () { captures++; return original.call(this); };
  try {
    for (const size of [50_000, 500_000, 2_000_000]) for (const paneCount of [1, 2]) {
      const markdown = fixture(size);
      const note = createNoteDraftState(createSessionSnapshot({ noteId: 'image-diag', path: '/image-diag.md', title: 'Title', markdown }));
      const editing = createDocumentEditingService({
        state: createNotepadState(note), isApplyingProgrammaticUpdate: () => false, isTitleEditing: () => false,
        resetPaneCommandAfterBodyInput: () => {}, clearRecentlyForgotten: () => {},
        scheduleAutosave: () => {}, scheduleSearch: () => {}, scheduleRelated: () => {}
      });
      const runtime = new EditorDocumentRuntime(note.working.body);
      let notifications = 0;
      const changed = (body: DocumentBody) => { notifications++; editing.recordUserEdit('source', note, body); sink += Number(documentHasCleanBuffer(note)); };
      const pane = createRuntimePane(runtime, markdown, markdown.length, changed, [imageState]);
      const sibling = paneCount === 2 ? createRuntimePane(runtime, markdown, 0, changed, [imageState]) : null;
      captures = 0; notifications = 0;
      const timing = measure(() => { pane.view.dispatch({ changes: { from: pane.readState().doc.length, insert: 'x' } }); });
      expect(notifications).toBe(count);
      expect(captures).toBe(0);
      expect(pane.readState().field(imageState).images).toHaveLength(0);
      expect(sibling?.readState().field(imageState).images ?? []).toHaveLength(0);
      console.log('GNEAUXGHTS_BODY_IMAGE_INVENTORY', JSON.stringify({ size, paneCount, timing, toStringCalls: captures, notifications }));
      runtime.destroy();
    }
  } finally { Text.prototype.toString = original; }
}, 60_000);

it('measures remaining size-dependent work in giant single lines and whitespace', () => {
  const original = Text.prototype.toString;
  let captures = 0;
  Text.prototype.toString = function () { captures++; return original.call(this); };
  try {
    for (const shape of ['singleLine', 'whitespace'] as const) {
      const markdown = (shape === 'singleLine' ? 'a' : ' ').repeat(2_000_000);
      const note = createNoteDraftState(createSessionSnapshot({ noteId: 'shape', path: '/shape.md', title: 'Title', markdown }));
      const editing = createDocumentEditingService({
        state: createNotepadState(note), isApplyingProgrammaticUpdate: () => false, isTitleEditing: () => false,
        resetPaneCommandAfterBodyInput: () => {}, clearRecentlyForgotten: () => {},
        scheduleAutosave: () => {}, scheduleSearch: () => {}, scheduleRelated: () => {}
      });
      const runtime = new EditorDocumentRuntime(note.working.body);
      const pane = createRuntimePane(runtime, markdown, markdown.length, body => {
        editing.recordUserEdit('source', note, body);
        sink += Number(documentHasCleanBuffer(note));
      });
      captures = 0;
      const timing = measure(i => pane.view.dispatch({ changes: {
        from: markdown.length - 1, to: markdown.length, insert: String.fromCharCode(65 + i)
      } }));
      expect(captures).toBe(0);
      console.log('GNEAUXGHTS_BODY_SHAPE', JSON.stringify({ shape, size: markdown.length, timing, toStringCalls: captures }));
      runtime.destroy();
    }
  } finally { Text.prototype.toString = original; }
});
