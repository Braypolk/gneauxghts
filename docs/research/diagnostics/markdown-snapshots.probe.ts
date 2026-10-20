// Diagnostic only. See ../gneauxghts-markdown-snapshots.md for invocation and limits.
// Historical string-callback interface; run at fd9c0ad1 for the callback baseline.
// That revision already optimizes inventory; original cold-parse timings predate it.
import { expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { createRuntimePane } from './testSupport';
import { createDocumentEditingService } from '../document/documentEditingService';
import { createNoteDraftState, createNotepadState } from '../state/noteStore';
import { createSessionSnapshot } from '../session/session';
import { documentHasCleanBuffer, updateDocumentMarkdown } from '../document/documentState';
import { computeDraftHash } from '../search/draftRef';
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

it('measures full-text consumers and structurally shared text', () => {
  for (const size of [50_000, 500_000, 2_000_000]) {
    const markdown = fixture(size);
    const base = EditorState.create({ doc: markdown }).doc;
    const pos = base.length - 4;
    const versions = Array.from({ length: count }, (_, i) => base.replace(pos, pos + 1, Text.of([String.fromCharCode(65 + i)])));
    const strings: string[] = [];
    const toString = measure(i => { const s = versions[i].toString(); strings[i] = s; sink += s.length; });
    const equalDirtyString = measure(i => { sink += Number(strings[i] === markdown); });
    const equalDirtyText = measure(i => { sink += Number(versions[i].eq(base)); });
    const originalChar = base.sliceString(pos, pos + 1);
    const reverted = versions.map(text => text.replace(pos, pos + 1, Text.of([originalChar])));
    const equalRevertedText = measure(i => { expect(reverted[i].eq(base)).toBe(true); });
    const relatedPair = measure(i => { sink += JSON.stringify(['/note.md', 'Title', markdown]).length + JSON.stringify(['/note.md', 'Title', strings[i]]).length; });
    const draftHash = measure(i => { sink += computeDraftHash(strings[i]).length; });
    const trim = measure(i => { sink += strings[i].trim().length; });
    const snapshotReference = measure(i => { const snap = { text: versions[i], version: i }; sink += snap.text.length + snap.version; });
    console.log('GNEAUXGHTS_SNAPSHOT_COMPONENTS', JSON.stringify({ size, toString, equalDirtyString, equalDirtyText, equalRevertedText, relatedPair, draftHash, trim, snapshotReference }));
  }
  expect(sink).toBeGreaterThan(0);
});

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
      const runtime = new EditorDocumentRuntime(markdown);
      let notifications = 0;
      const changed = (body: string) => { notifications++; editing.recordUserEdit('source', note, body); sink += Number(documentHasCleanBuffer(note)); };
      const pane = createRuntimePane(runtime, markdown, markdown.length, changed);
      const sibling = paneCount === 2 ? createRuntimePane(runtime, markdown, 0, changed) : null;
      const report: Record<string, unknown> = { size, paneCount };
      for (const kind of ['insert', 'replace', 'selection'] as const) {
        if (kind === 'replace') {
          runtime.replaceMarkdown(markdown, { flushHistory: true, notifyMarkdownChange: false });
          updateDocumentMarkdown(note, markdown);
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
      for (let i = 0; i < 10; i++) sink += runtime.markdown.length;
      expect(captures).toBe(capturesBefore);
      expect(sibling?.readState().doc.length ?? pane.readState().doc.length).toBe(pane.readState().doc.length);
      console.log('GNEAUXGHTS_SNAPSHOT_RUNTIME', JSON.stringify(report));
      runtime.destroy();
    }
  } finally { prototype.toString = original; }
});

it('checks an immutable snapshot candidate and difficult document shapes', () => {
  class Body {
    #markdown: string | null = null;
    serializations = 0;
    constructor(readonly text: Text) {}
    get markdown() {
      if (this.#markdown === null) { this.serializations++; this.#markdown = this.text.toString(); }
      return this.#markdown;
    }
    sameContent(other: Body) { return this.text.eq(other.text); }
    get hasContent() {
      for (const chunk of this.text) if (/\S/u.test(chunk)) return true;
      return false;
    }
  }
  for (const shape of ['multiline', 'singleLine', 'whitespace'] as const) {
    const markdown = shape === 'multiline' ? fixture(2_000_000) : (shape === 'singleLine' ? 'a' : ' ').repeat(2_000_000);
    const base = new Body(EditorState.create({ doc: markdown }).doc);
    const snapshots = Array.from({ length: count }, (_, i) => new Body(base.text.replace(base.text.length - 1, base.text.length, Text.of([String.fromCharCode(65 + i)]))));
    const dirtyEquality = measure(i => { sink += Number(snapshots[i].sameContent(base)); });
    const original = base.text.sliceString(base.text.length - 1);
    const reverted = snapshots.map(snap => new Body(snap.text.replace(snap.text.length - 1, snap.text.length, Text.of([original]))));
    const revertedEquality = measure(i => { expect(reverted[i].sameContent(base)).toBe(true); });
    const hasContent = measure(i => { sink += Number(snapshots[i].hasContent); });
    for (let i = 0; i < 100; i++) { const body = snapshots[i % snapshots.length]; sink += body.text.length; }
    expect(snapshots.reduce((sum, body) => sum + body.serializations, 0)).toBe(0);
    const captured = snapshots[0];
    let live = captured;
    live = snapshots[1];
    expect(captured).not.toBe(live);
    expect(captured.markdown).not.toBe(live.markdown);
    const before = captured.serializations;
    for (let i = 0; i < 10; i++) sink += captured.markdown.length;
    expect(captured.serializations).toBe(before);
    console.log('GNEAUXGHTS_SNAPSHOT_CANDIDATE', JSON.stringify({ shape, size: markdown.length, dirtyEquality, revertedEquality, hasContent, serializationsForRepeatedSnapshotRead: captured.serializations }));
  }
});

it('isolates image inventory as another full-body consumer', () => {
  const original = Text.prototype.toString;
  let captures = 0;
  Text.prototype.toString = function () { captures++; return original.call(this); };
  try {
    for (const size of [50_000, 500_000, 2_000_000]) for (const paneCount of [1, 2]) {
      const markdown = fixture(size);
      const runtime = new EditorDocumentRuntime(markdown);
      const note = createNoteDraftState(createSessionSnapshot({ noteId: 'image-diag', path: '/image-diag.md', title: 'Title', markdown }));
      const editing = createDocumentEditingService({
        state: createNotepadState(note), isApplyingProgrammaticUpdate: () => false, isTitleEditing: () => false,
        resetPaneCommandAfterBodyInput: () => {}, clearRecentlyForgotten: () => {},
        scheduleAutosave: () => {}, scheduleSearch: () => {}, scheduleRelated: () => {}
      });
      let notifications = 0;
      const changed = (body: string) => { notifications++; editing.recordUserEdit('source', note, body); sink += Number(documentHasCleanBuffer(note)); };
      const pane = createRuntimePane(runtime, markdown, markdown.length, changed, [imageState]);
      const sibling = paneCount === 2 ? createRuntimePane(runtime, markdown, 0, changed, [imageState]) : null;
      captures = 0; notifications = 0;
      const timing = measure(() => { pane.view.dispatch({ changes: { from: pane.readState().doc.length, insert: 'x' } }); });
      expect(notifications).toBe(count);
      expect(pane.readState().field(imageState).images).toHaveLength(0);
      expect(sibling?.readState().field(imageState).images ?? []).toHaveLength(0);
      console.log('GNEAUXGHTS_SNAPSHOT_IMAGE_INVENTORY', JSON.stringify({ size, paneCount, timing, toStringCalls: captures, notifications }));
      runtime.destroy();
    }
  } finally { Text.prototype.toString = original; }
}, 60_000);
