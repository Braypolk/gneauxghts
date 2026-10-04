import { bench, describe } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { createMarkdownLanguage } from './markdownLanguage';
import { buildMarkdownDecorations } from './markdownExtensions';
import { collectPassiveTableRanges } from '../editor/passiveTableExtension';
import { markdownCodeRanges } from './codeContext';

const doc = Array.from({ length: 500 }, (_, i) => `## Heading ${i}\n\nProse **bold** and [[Note|alias]] with ==highlight==.\n\n| one | two |\n| --- | --- |\n| a | b |\n\n`).join('');
let state = EditorState.create({ doc, extensions: [createMarkdownLanguage()] });
ensureSyntaxTree(state, doc.length, 5000);
state = state.update({}).state;
const a = { state } as EditorView;
const b = { state: state.update({ selection: { anchor: doc.length } }).state } as EditorView;

describe(`full-document decoration work (${doc.length} UTF-16 units, 500 sections)`, () => {
  bench('one pane selection rebuild', () => { buildMarkdownDecorations(a); }, { time: 150, iterations: 10 });
  bench('two pane selection rebuilds', () => { buildMarkdownDecorations(a); buildMarkdownDecorations(b); }, { time: 150, iterations: 10 });
  bench('passive table inventory', () => { collectPassiveTableRanges(state.doc); }, { time: 150, iterations: 10 });
  bench('new document code context', () => { markdownCodeRanges(EditorState.create({ doc }).doc); }, { time: 150, iterations: 10 });
  bench('shared code context cached selection query', () => { markdownCodeRanges(state.doc); }, { time: 150, iterations: 10 });
});
