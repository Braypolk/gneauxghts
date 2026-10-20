import { markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownLanguage } from '../markdown/markdownLanguage';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { createRuntimePane } from './testSupport';

// Configured Markdown parsers share this prototype. Observe real parser starts,
// without replacing parsing or exposing the runtime's private history state.
const parserPrototype = Object.getPrototypeOf(markdownLanguage.parser);

describe('document parsing ownership', () => {
  it('keeps the headless history root free of Markdown parsing across its lifetime', () => {
    const parse = vi.spyOn(parserPrototype, 'createParse');
    const runtime = new EditorDocumentRuntime('> **before**');
    try {
      // These real EditorStates have no language: any parse would belong to the
      // root, including roots recreated by committed adoption or detached edits.
      const first = createRuntimePane(runtime, runtime.markdown, 2);
      const second = createRuntimePane(runtime, runtime.markdown, 0);
      first.view.dispatch({ changes: { from: 4, insert: 'new ' } });
      expect(runtime.markdown).toBe('> **new before**');
      expect(runtime.undo(second.controller.paneKey)).toBe(true);
      expect(second.view.state.doc.toString()).toBe('> **before**');
      expect(runtime.redo(first.controller.paneKey)).toBe(true);
      runtime.restoreTransientMarkdown('> recovered');
      expect(second.view.state.doc.toString()).toBe('> recovered');
      runtime.adoptCommittedMarkdown('> committed');
      expect(first.view.state.doc.toString()).toBe('> committed');
      expect(runtime.undo(second.controller.paneKey)).toBe(false);
      runtime.detachController(first.controller);
      runtime.detachController(second.controller);
      runtime.ensureMarkdown('> detached');
      expect(runtime.markdown).toBe('> detached');
      expect(parse).not.toHaveBeenCalled();
    } finally {
      runtime.destroy();
      parse.mockRestore();
    }
  });

  it.each([1, 2])('parses only the %i attached panes during shared edits, undo and redo', (panes) => {
    const parse = vi.spyOn(parserPrototype, 'createParse');
    const original = '> **bold**\n> continued\n\noutside';
    const runtime = new EditorDocumentRuntime(original);
    try {
      const fixtures = Array.from({ length: panes }, () => createRuntimePane(
        runtime, original, 0, vi.fn(), [createMarkdownLanguage()]
      ));
      function expectSyntax(markdown: string, bold: boolean) {
        expect(runtime.markdown).toBe(markdown);
        for (const fixture of fixtures) {
          const state = fixture.readState();
          expect(state.doc.toString()).toBe(markdown);
          const tree = ensureSyntaxTree(state, state.doc.length, 1000);
          expect(tree?.toString().includes('StrongEmphasis')).toBe(bold);
        }
        expect(parse).toHaveBeenCalledTimes(panes);
        parse.mockClear();
      }
      parse.mockClear();
      fixtures[0].view.dispatch({ changes: { from: 2, to: 4 }, selection: { anchor: 2 } });
      const edited = '> bold**\n> continued\n\noutside';
      expectSyntax(edited, false);
      expect(runtime.undo(fixtures.at(-1)!.controller.paneKey)).toBe(true);
      expectSyntax(original, true);
      expect(runtime.redo(fixtures[0].controller.paneKey)).toBe(true);
      expectSyntax(edited, false);
    } finally {
      runtime.destroy();
      parse.mockRestore();
    }
  });
});
