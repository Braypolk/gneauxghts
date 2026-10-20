// Opt-in diagnosis only. No production module imports this harness.
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ParseContext, language, ensureSyntaxTree } from '@codemirror/language';
import { NodeProp, IterMode, type Tree } from '@lezer/common';
import { languages } from '../vendor/codemirrorLanguageData';
import { createMarkdownLanguage } from '../features/notepad/markdown/markdownLanguage';
import { Autolink as reference } from '../../../e2e/support/fixtures/markdownAutolinkReference.mjs';
import { inspectParagraphWork } from './markdownParagraphProbe';
import { prepareFullAppMarkdown, measureFullAppMarkdown, verifyFullAppGiantQuote } from './markdownFullAppHarness';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), samples: values };
}
function views() { return [...document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')].map(el => EditorView.findFromDOM(el)!); }

// Open-loop 12.5 edits/s. All timers are queued before work starts, so lateness
// measures backlog against intended input times, rather than delaying the sender.
export async function rapidTyping(count = 25, interval = 80) {
  const editors = views(), source = editors[0];
  const dispatch: number[] = [], lateness: number[] = [], frameDelay: number[] = [];
  const intended = source.state.doc.toString();
  const pos = source.viewport.from + 5;
  const start = performance.now() + 100;
  await Promise.all(Array.from({ length: count }, (_, i) => new Promise<void>((resolve, reject) => {
    const target = start + i * interval;
    setTimeout(() => {
      try {
        const before = performance.now();
        source.dispatch({ changes: { from: pos + i, insert: i % 2 ? 'x' : 'y' } });
        const after = performance.now();
        for (const editor of editors) editor.coordsAtPos(editor.viewport.from);
        requestAnimationFrame(() => {
          if (i >= 5) { dispatch.push(after - before); lateness.push(before - target); frameDelay.push(performance.now() - target); }
          resolve();
        });
      } catch (error) { reject(error); }
    }, Math.max(0, target - performance.now()));
  })));
  const completedMs = performance.now() - start;
  await frame(); await frame();
  const inserted = Array.from({ length: count }, (_, i) => i % 2 ? 'x' : 'y').join('');
  const expected = intended.slice(0, pos) + inserted + intended.slice(pos);
  for (const view of editors) if (view.state.doc.toString() !== expected) throw new Error('Rapid input lost, reordered, or diverged between panes');
  await sleep(1200);
  return { count, warmups: 5, interval, completedMs, dispatch: summary(dispatch), inputLateness: summary(lateness), nextFrameFromIntendedInput: summary(frameDelay) };
}

// Temporarily replace only the known GFM callback in existing pane parsers.
// Both variants use identical buckets, state, scheduling and production views.
// Restored in finally; never imported by the app outside this diagnostic.
function installReference(enabled: boolean) {
  const restorers: (() => void)[] = [];
  if (!enabled) for (const parser of new Set(views().map(view => view.state.facet(language)!.parser as any))) {
    const index = parser.inlineNames.indexOf('Autolink');
    if (index < 0) throw new Error('GFM autolink callback missing');
    const candidate = parser.inlineParsers[index];
    const saved = parser.inlineParsers, buckets = parser.inlineDispatch;
    const replace = (fn: unknown) => fn === candidate ? reference.parseInline[0].parse : fn;
    parser.inlineParsers = saved.map(replace);
    parser.inlineDispatch = buckets.map((bucket: unknown[]) => bucket.map(replace));
    restorers.push(() => { parser.inlineParsers = saved; parser.inlineDispatch = buckets; });
  }
  return () => restorers.reverse().forEach(restore => restore());
}
export async function measureSynchronousParagraph(enabled: boolean, panes: number, native = false, stage: 'giant' | 'rapid200' | 'rapid80' | 'work' = 'giant') {
  async function focus() {
    if (!native) return;
    await (window.__TAURI_INTERNALS__ as { invoke(command: string, args: object): Promise<unknown> }).invoke('plugin:window|set_focus', { label: 'main' });
    views()[0].contentDOM.focus(); await sleep(100); await frame();
    const deadline = performance.now() + 1000;
    while (!document.hasFocus() && performance.now() < deadline) await sleep(50);
  }
  function assertFocus() { if (native && (!document.hasFocus() || document.visibilityState !== 'visible')) throw new Error(`Native measurement lost focus: ${JSON.stringify({ focused: document.hasFocus(), visibility: document.visibilityState, active: document.activeElement?.className })}`); }
  async function prepare() {
    await focus(); assertFocus();
    let deadline: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        prepareFullAppMarkdown('quote', 50_000, panes),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error(`Fixture setup did not settle: ${JSON.stringify({ focused: document.hasFocus(), visibility: document.visibilityState })}`)), 30_000); })
      ]);
    } finally { clearTimeout(deadline!); }
  }
  const environment = await prepare();
  const restore = installReference(enabled);
  try {
    await focus(); assertFocus();
    let measurements: unknown;
    if (stage === 'giant') measurements = await measureFullAppMarkdown('document');
    else if (stage === 'work') measurements = await inspectParagraphWork();
    else measurements = await rapidTyping(25, stage === 'rapid200' ? 200 : 80);
    assertFocus();
    const verified = await verifyFullAppGiantQuote(50_000);
    return { enabled, panes, stage, environment, measurements, verified };
  } finally { restore(); }
}
// Capture every visible syntax node and each embedded tree/overlay, independent
// of tree-buffer packing. Mounted trees can otherwise be invisible to toString.
let mountsVisited = 0;
function signature(tree: Tree): string {
  const nodes: unknown[] = [], mounts: unknown[] = [];
  const cursor = tree.cursor(IterMode.IgnoreMounts);
  do {
    nodes.push([cursor.name, cursor.from, cursor.to]);
    if (cursor.tree) {
      const mounted = cursor.tree.prop(NodeProp.mounted);
      if (mounted) { mountsVisited++; mounts.push({ at: cursor.from, overlay: mounted.overlay?.map(r => [r.from, r.to]), inner: signature(mounted.tree) }); }
    }
  } while (cursor.next());
  return JSON.stringify({ nodes, mounts });
}
export async function verifySynchronousParagraph() {
  await languages.find(description => description.name === 'HTML')!.load();
  mountsVisited = 0;
  let comparisons = 0;
  const names = new Set<string>();
  function parse(state: EditorState, parser: any, partial: boolean) {
    const context = (ParseContext as any).create(parser, state, { from: 0, to: Math.min(state.doc.length, 400) });
    if (partial) { context.work(() => true, 400); context.takeTree(); }
    if (!context.work(60_000, state.doc.length)) throw new Error('Diagnostic correctness parse incomplete');
    return context.tree as Tree;
  }
  {
    const dialect = createMarkdownLanguage();
    const chunk = '> > www.example.com a@example.com https://example.com/x **bold** _é_ ~~strike~~ ==hi== %%hidden%% [[Note|alias]] ![[image.png]] <i>html</i> [link](https://example.com) &amp; `code` \\*\n';
    const documents = [
      chunk.repeat(600) + '\nend',
      '> ' + ('alpha **b**\n> beta\n').repeat(1200) + '\nend',
      ('[reference][target] ' + 'z'.repeat(20) + '\n').repeat(700) + '\n[target]: https://example.com\n',
      chunk.repeat(300) + '\n<div><b>inside</b></div>\n\n```html\n<section>code</section>\n```\n\n' + chunk.repeat(300),
      ('- item\n  ' + 'é *word* '.repeat(20) + '\n').repeat(500),
      '# Heading\n\n' + 'plain &amp; text '.repeat(1500)
    ];
    const states = documents.map(doc => EditorState.create({ doc, extensions: [dialect] }));
    for (let state of states) {
      const parser = state.facet(language)!.parser as any;
      const versions = [state];
      state = state.update({ changes: { from: 5, insert: '**==%% é ' } }).state; versions.push(state);
      state = state.update({ changes: { from: 0, insert: '\nshift\n' } }).state; versions.push(state);
      state = state.update({ changes: { from: Math.floor(state.doc.length / 2), insert: '\n\n```html\n<i>changed</i>\n```\n\n' } }).state; versions.push(state);
      for (const version of versions) {
        // Cold stopped/resumed, then an independent warm parse, same revision.
        const cold = parse(version, parser, true), warm = parse(version, parser, false);
        // Same app dialect with the unchanged upstream autolink recognizer.
        const freshParser = parser.configure(reference);
        const fresh = parse(version, freshParser, false);
        if (signature(cold) !== signature(fresh) || signature(warm) !== signature(fresh)) throw new Error('Optimized/stopped syntax or embedded mounts differ from upstream');
        warm.iterate({ enter(node) { names.add(node.name); } });
        comparisons += 2;
      }
    }
    if (!mountsVisited) throw new Error('No embedded mounts checked');
    for (const name of ['Wikilink', 'WikiImage', 'Highlight', 'InlineComment', 'HTMLTag', 'FencedCode']) if (!names.has(name)) throw new Error(`Missing dialect coverage ${name}`);
    return { comparisons, mountsVisited, syntaxNames: [...names].sort() };
  }
}
