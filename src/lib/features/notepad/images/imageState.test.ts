import { describe, expect, it, vi } from 'vitest';
import { ChangeSet, EditorState, Text, type TransactionSpec } from '@codemirror/state';
import { Parser } from '@lezer/common';
import { imageState } from './imageState';
import { parseImageEmbeds } from './imageEmbedParser';
import { EditorDocumentRuntime } from '../editor/editorDocumentRuntime';
import { createRuntimePane } from '../editor/testSupport';

const stateFor = (doc: string) => EditorState.create({ doc, extensions: [imageState] });
const images = (state: EditorState) => state.field(imageState).images;
function check(state: EditorState) {
  expect(images(state)).toEqual(parseImageEmbeds(state.doc.toString()));
  return state;
}
function edit(state: EditorState, spec: TransactionSpec) { return check(state.update(spec).state); }
function replace(state: EditorState, before: string, after: string) {
  const from = state.doc.toString().indexOf(before);
  expect(from).toBeGreaterThanOrEqual(0);
  return edit(state, { changes: { from, to: from + before.length, insert: after } });
}
const gap = 'Far away ordinary prose.\n\n'.repeat(2500);

describe('complete incremental image inventory', () => {
  it.each(['![label][ref]', '![ref][]', '![ref]'])('resolves %s across distant definition edits in both orders', use => {
    for (const definitionFirst of [false, true]) {
      const definition = '[ref]: a.png';
      let state = check(stateFor(definitionFirst ? `${definition}\n\n${gap}${use}` : `${use}\n\n${gap}${definition}`));
      expect(images(state).map(image => image.assetName)).toEqual(['a.png']);
      state = replace(state, 'a.png', 'assets/b.webp');
      expect(images(state)[0].assetName).toBe('b.webp');
      state = replace(state, '[ref]:', '[other]:');
      expect(images(state)).toHaveLength(0);
      state = replace(state, '[other]:', '[ref]:');
      expect(images(state)).toHaveLength(1);
      state = replace(state, '[ref]: assets/b.webp', 'ordinary definition removed');
      expect(images(state)).toHaveLength(0);
      state = edit(state, { changes: { from: state.doc.length, insert: '\n\n[ref]: restored.svg' } });
      expect(images(state)[0].assetName).toBe('restored.svg');
    }
  });
  it('handles duplicate definitions, unresolved uses, dimensions, normalized labels and multiple occurrences', () => {
    let state = check(stateFor(`![late][ ReF ]\n\n${gap}> ![second|100](<a%20b.png> "title")\n\n- ![[a.png|120x80]]\n\n![ref][]\n\n![ref]`));
    expect(images(state)).toHaveLength(2);
    state = edit(state, { changes: { from: state.doc.length, insert: '\n\n[ref]: a.png\n\n[ref]: b.png' } });
    expect(images(state).map(image => image.assetName)).toEqual(['a.png', 'a b.png', 'a.png', 'a.png', 'a.png']);
    state = replace(state, '[ref]: a.png', '[removed]: a.png');
    expect(images(state).filter(image => image.target.fileName === 'b.png')).toHaveLength(3);
    state = edit(state, { changes: { from: 0, insert: 'Position shift\n\n' } });
    expect(images(state)[0].from).toBe('Position shift\n\n'.length);
  });
  it.each([
    ['```\n', '\n```'], ['~~~md\n', '\n~~~'], ['<!--\n', '\n-->'], ['%%\n\n', '\n\n%%'], ['`', '`']
  ])('invalidates distant literal boundaries %s', (open, close) => {
    let state = check(stateFor(`${open}${gap}![[hidden.png]]${close}\n\n![[visible.png]]`));
    // A multiline inline-code span remains whatever the established parser supports.
    state = edit(state, { changes: { from: 0, to: open.length, insert: '' } });
    state = edit(state, { changes: { from: 0, insert: open } });
    state = replace(state, close, '');
    state = edit(state, { changes: { from: state.doc.length, insert: close } });
  });
  it('preserves supported block forms and escaped syntax through edits', () => {
    let state = check(stateFor('\\![[escaped.png]]\n\n    ![code](a.png)\n\n> ![quote](a.png)\n\n- ![[list.png]]\n\nprose ![inline](a.png) after\n\n| Photo |\n| --- |\n| ![cell](a.png) |'));
    state = replace(state, '\\!', '!');
    expect(images(state)[0].assetName).toBe('escaped.png');
    state = replace(state, '![[escaped.png]]', '\\![[escaped.png]]');
    state = replace(state, '    ![code]', '![code]');
    expect(images(state)[0].assetName).toBe('a.png');
  });
  it('reconsiders distant references when comments hide definitions or uses', () => {
    for (const marker of ['%%', '<!--']) {
      const close = marker === '%%' ? '%%' : '-->';
      let state = check(stateFor(`![ref]\n\n${gap}${marker}\n\n[ref]: a.png\n\n${close}`));
      expect(images(state)).toHaveLength(0);
      state = replace(state, marker, '');
      expect(images(state)).toHaveLength(1);
      state = edit(state, { changes: { from: 0, insert: `${marker}\n\n` } });
      expect(images(state)).toHaveLength(0);
    }
  });
  it('enters and leaves the syntax-free fast path, including split delimiters and identical replacements', () => {
    let state = stateFor(`${gap}plain`);
    state = edit(state, { changes: { from: state.doc.length, insert: '[' } });
    state = edit(state, { changes: { from: state.doc.length - 1, insert: '!' } });
    state = edit(state, { changes: { from: state.doc.length, insert: 'photo](a.png)' } });
    expect(images(state)).toHaveLength(1);
    state = replace(state, '![photo](a.png)', '![photo](a.png)');
    state = replace(state, '![photo](a.png)', 'plain');
    expect(images(state)).toHaveLength(0);
    state = edit(state, { changes: [{ from: 0, insert: '!' }, { from: state.doc.length, insert: ' ![[new.png]]' }] });
    expect(images(state)[0].assetName).toBe('new.png');
  });
  it('matches cold parsing during deterministic edits to syntax and context', () => {
    let state = stateFor('![ref]\n\n[ref]: a.png\n\n![[b.png]]\n\n`code`\n\n%%comment%%\n\n<!--html-->');
    const inserts = ['!', '[', ']', '\\', '`', '\n', '%%', '~~~\n', '<!--', '-->', 'a.png', ': ', 'x', ''];
    let seed = 1857;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let i = 0; i < 250; i++) {
      const from = random() % (state.doc.length + 1);
      const to = Math.min(state.doc.length, from + random() % 4);
      state = edit(state, { changes: { from, to, insert: inserts[random() % inserts.length] } });
    }
  });
  it('does no image parse or full string conversion for ordinary edits without bangs or selections', () => {
    const parse = vi.spyOn(Parser.prototype, 'parse');
    const stringify = vi.spyOn(Text.prototype, 'toString');
    try {
      let state = stateFor(gap);
      for (let i = 0; i < 10; i++) state = state.update({ changes: { from: 10, insert: 'x' } }).state;
      const inventory = images(state);
      state = state.update({ selection: { anchor: 2 } }).state;
      expect(images(state)).toBe(inventory);
      expect(parse).not.toHaveBeenCalled();
      expect(stringify).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); stringify.mockRestore(); }
  });
  it('does not share an identical ChangeSet across different starting content', () => {
    const first = stateFor('![[a.png]]'), second = stateFor('![[b.png]]');
    const changes = ChangeSet.of({ from: 0, insert: 'x ' }, first.doc.length);
    expect(images(edit(first, { changes }))[0].assetName).toBe('a.png');
    expect(images(edit(second, { changes }))[0].assetName).toBe('b.png');
  });
});

it('shares complete inventories across real runtime panes while keeping selection, scroll and undo local', () => {
  const markdown = `![[a.png]]\n\n${gap}![ref][]\n\n[ref]: b.png`;
  const runtime = new EditorDocumentRuntime(markdown);
  const panes = [createRuntimePane(runtime, markdown, 0, undefined, [imageState]), createRuntimePane(runtime, markdown, markdown.indexOf('![ref]'), undefined, [imageState])];
  panes[0].setViewport(100, 3); panes[1].setViewport(900, 7);
  const lifetimes = panes.map(pane => pane.readState().field(imageState).lifetime);
  const parse = vi.spyOn(Parser.prototype, 'parse');
  try {
    for (const [index, pane] of panes.entries()) {
      const sibling = panes[1 - index];
      sibling.setViewport(900 + index, 7 + index);
      const oldSelection = sibling.readState().selection.main.head;
      const from = pane.readState().doc.toString().lastIndexOf(': ') + 2;
      parse.mockClear();
      pane.view.dispatch({ changes: { from, to: from + 1, insert: index ? 'd' : 'c' }, selection: { anchor: 1 } });
      expect(parse).toHaveBeenCalledTimes(1);
      expect(images(pane.readState())).toBe(images(sibling.readState()));
      expect(images(sibling.readState())[1].assetName).toBe(index ? 'd.png' : 'c.png');
      expect(sibling.readState().selection.main.head).toBe(oldSelection);
      expect(sibling.readViewport()).toEqual({ scrollTop: 900 + index, scrollLeft: 7 + index });
      check(pane.readState()); check(sibling.readState());
    }
    // Undo/redo use the runtime's actual shared root, including identical net changes.
    expect(runtime.undo(panes[0].controller.paneKey)).toBe(true);
    panes.forEach(pane => check(pane.readState()));
    expect(images(panes[0].readState())[1].assetName).toBe('b.png');
    expect(runtime.redo(panes[1].controller.paneKey)).toBe(true);
    panes.forEach(pane => check(pane.readState()));
    expect(images(panes[0].readState())[1].assetName).toBe('d.png');
    for (const pane of panes) pane.view.dispatch({ changes: { from: 0, to: 1, insert: '!' } });
    expect(images(panes[0].readState())).toEqual(images(panes[1].readState()));
    expect(panes.map(pane => pane.readState().field(imageState).lifetime)).toEqual(lifetimes);
  } finally { parse.mockRestore(); runtime.destroy(); }
});
