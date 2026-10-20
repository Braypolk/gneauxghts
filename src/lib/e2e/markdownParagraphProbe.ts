// Diagnostic only. Opt-in WebDriver caller imports this after preparing the app.
// Instrumented durations explain work placement, not end-user benchmark latency.
import { markdownLanguage } from '@codemirror/lang-markdown';
import { ParseContext } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

export async function inspectParagraphWork() {
  const editors = [...document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')]
    .map(element => EditorView.findFromDOM(element)!);
  const prototype = Object.getPrototypeOf(markdownLanguage.parser);
  const originalCreate = prototype.createParse, originalInline = prototype.parseInline;
  const records: any[] = [], inline: any[] = [];
  let phase = 'before-edit', active: number | null = null;
  const documents = new WeakMap<object, number>();
  let documentCount = 0;
  function context() {
    const cx = ParseContext.get() as any;
    if (!cx) return null;
    if (!documents.has(cx.state.doc)) documents.set(cx.state.doc, ++documentCount);
    return { document: documents.get(cx.state.doc), viewport: cx.viewport, treeLen: cx.treeLen };
  }
  prototype.createParse = function (this: any, ...args: any[]) {
    const start = performance.now();
    const parse = originalCreate.apply(this, args);
    const record = { id: records.length, phase, context: context(), start, length: args[0].length,
      fragments: args[1].map((f: any) => ({ from: f.from, to: f.to, openStart: f.openStart, openEnd: f.openEnd })),
      stack: new Error().stack?.split('\n').slice(1, 7), advances: [] as any[] };
    records.push(record);
    const advance = parse.advance;
    parse.advance = function (this: any) {
      const before = performance.now(), from = parse.parsedPos, previous = active;
      active = record.id;
      try {
        const tree = advance.call(this);
        record.advances.push({ phase, from, to: parse.parsedPos, stoppedAt: parse.stoppedAt,
          done: !!tree, treeLength: tree?.length, ms: performance.now() - before });
        return tree;
      } finally { active = previous; }
    };
    return parse;
  };
  prototype.parseInline = function (this: any, text: string, offset: number) {
    const before = performance.now();
    const result = originalInline.call(this, text, offset);
    inline.push({ parse: active, phase, length: text.length, offset, elements: result.length, ms: performance.now() - before });
    return result;
  };
  const edits: any[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      phase = `edit-${i}`;
      const view = editors[0], pos = view.state.doc.lineAt(view.viewport.from).from + 5;
      const started = performance.now();
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: i % 2 ? 'x' : 'y' } });
      edits.push({ phase, dispatchMs: performance.now() - started });
      phase = `background-${i}`;
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    return { editors: editors.length, records, inline, edits };
  } finally {
    prototype.createParse = originalCreate;
    prototype.parseInline = originalInline;
  }
}
