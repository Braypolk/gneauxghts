// Copy to src/lib/features/notepad/editor/imageInventoryDiagnostic.temporary.test.ts.
// Diagnostic only: real runtime + editing boundary, no mounted view/DOM or persistence.
import { expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { Parser } from '@lezer/common';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { createRuntimePane } from './testSupport';
import { createDocumentEditingService } from '../document/documentEditingService';
import { createNoteDraftState, createNotepadState } from '../state/noteStore';
import { createSessionSnapshot } from '../session/session';
import { documentHasCleanBuffer } from '../document/documentState';
import { imageState } from '../images/imageState';

const prose = 'Plain note text with enough ordinary prose to resemble a multiline Markdown note.\n\n';
const warmups = 4, samples = 21;
it('benchmarks complete image inventory through the runtime and document boundary', () => {
  const stringify = Text.prototype.toString, parse = Parser.prototype.parse;
  let strings = 0, parses = 0, incremental = 0, notifications = 0;
  Text.prototype.toString = function () { strings++; return stringify.call(this); };
  Parser.prototype.parse = function (...args: Parameters<typeof parse>) {
    parses++; if (args[1]?.length) incremental++;
    return parse.apply(this, args);
  };
  try {
    for (const size of [50_000, 500_000, 2_000_000]) for (const shape of ['none', 'inline', 'reference']) for (const panes of [1, 2]) {
      const lead = shape === 'inline' ? '![first](a.png)\n\n' : shape === 'reference' ? '![photo][ref]\n\n![ref][]\n\n![ref]\n\n' : '';
      const tail = shape === 'reference' ? '\n\n[ref]: a.png\n' : shape === 'inline' ? '\n\n![[a.png]]\n' : '';
      const markdown = lead + prose.repeat(Math.ceil(size / prose.length)).slice(0, size - lead.length - tail.length) + tail;
      const runtime = new EditorDocumentRuntime(markdown);
      const note = createNoteDraftState(createSessionSnapshot({ noteId: 'diag', path: '/diag.md', title: 'Title', markdown }));
      const editingDeps = {
        state: createNotepadState(note), isApplyingProgrammaticUpdate: () => false, isTitleEditing: () => false,
        resetPaneCommandAfterBodyInput: () => {}, clearRecentlyForgotten: () => {},
        // Keep this standalone probe compatible with the pre-redesign editing service too.
        clearSelectedRelatedText: () => {},
        scheduleAutosave: () => {}, scheduleSearch: () => {}, scheduleRelated: () => {}
      };
      const editing = createDocumentEditingService(editingDeps);
      const changed = (body: string) => { notifications++; editing.recordUserEdit('source', note, body); documentHasCleanBuffer(note); };
      const views = Array.from({ length: panes }, (_, i) => createRuntimePane(runtime, markdown, i ? 0 : markdown.length, changed, [imageState]));
      for (const kind of ['ordinary', 'imageOrDefinition', 'selection']) {
        const timing: number[] = [];
        strings = 0; parses = 0; incremental = 0; notifications = 0;
        for (let i = 0; i < warmups + samples; i++) {
          const pane = views[i % panes];
          const start = performance.now();
          if (kind === 'ordinary') pane.view.dispatch({ changes: { from: pane.readState().doc.length, insert: 'x' } });
          else if (kind === 'selection') pane.view.dispatch({ selection: { anchor: i + 1 } });
          else if (shape === 'none') {
            const doc = pane.readState().doc;
            pane.view.dispatch({ changes: i % 2 === 0 ? { from: doc.length, insert: '\n\n![[a.png]]' } : { from: doc.length - 12, to: doc.length, insert: '' } });
          } else {
            const from = shape === 'inline' ? lead.indexOf('a.png') : markdown.lastIndexOf('a.png');
            pane.view.dispatch({ changes: { from, to: from + 1, insert: i % 2 === 0 ? 'b' : 'a' } });
          }
          if (i >= warmups) timing.push(performance.now() - start);
        }
        timing.sort((a, b) => a - b);
        expect(views.every(view => view.readState().doc.eq(views[0].readState().doc))).toBe(true);
        console.log('IMAGE_INVENTORY_BENCH', JSON.stringify({ size, shape, panes, kind, warmups, samples,
          median: +timing[10].toFixed(3), p95: +timing[19].toFixed(3), max: +timing[20].toFixed(3), strings, parses, incremental, notifications }));
      }
      runtime.destroy();
    }
  } finally { Text.prototype.toString = stringify; Parser.prototype.parse = parse; }
}, 240_000);
