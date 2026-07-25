import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type Range } from '@codemirror/state';
import type { Decoration, EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { decorateWikilink } from '$lib/features/notepad/markdown/decorations/wikilinks';
import { obsidianMarkdownExtensions } from '$lib/features/notepad/markdown/obsidianMarkdownExtensions';
import { parseWikilink } from '$lib/features/notepad/wikilinks/parse';
import { getWikilinkAtPosition } from './wikilinks';

function createState(doc: string, anchor = 0) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage, extensions: obsidianMarkdownExtensions })]
  });
}

function syntaxNodes(doc: string) {
  const state = createState(doc);
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) {
    throw new Error('failed to parse wikilink test document');
  }

  const nodes: { name: string; from: number; to: number }[] = [];
  tree.iterate({
    enter: ({ name, from, to }) => {
      nodes.push({ name, from, to });
    }
  });
  return nodes;
}

function decorationSpecs(doc: string, anchor: number) {
  const state = createState(doc, anchor);
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) {
    throw new Error('failed to parse wikilink test document');
  }

  const decorations: Range<Decoration>[] = [];
  const view = { state } as EditorView;
  tree.iterate({
    enter: (node) =>
      decorateWikilink(
        {
          view,
          decorations,
          selectionOverlaps: () => false
        },
        node
      )
  });

  return decorations.map((range) => ({
    from: range.from,
    to: range.to,
    class: range.value.spec.class as string | undefined,
    isAtomic: range.value.spec.gnAtomic === true
  }));
}

describe('parseWikilink', () => {
  it('extracts a custom alias and its separator position', () => {
    expect(parseWikilink('some long name of a wikilink|shortname')).toEqual({
      target: 'some long name of a wikilink',
      alias: 'shortname',
      separatorOffset: 28
    });
  });

  it('trims the target and alias without changing source offsets', () => {
    expect(parseWikilink(' target | alias ')).toEqual({
      target: 'target',
      alias: 'alias',
      separatorOffset: 8
    });
  });

  it('does not alias links with an empty target or display name', () => {
    expect(parseWikilink('target|')).toEqual({
      target: 'target',
      alias: null,
      separatorOffset: 6
    });
    expect(parseWikilink('|alias')).toEqual({
      target: '',
      alias: null,
      separatorOffset: 0
    });
    expect(parseWikilink('target')).toEqual({
      target: 'target',
      alias: null,
      separatorOffset: null
    });
  });
});

describe('wikilink Markdown syntax', () => {
  it('parses target and alias nodes', () => {
    const doc = 'before [[long target|short]] after';
    const nodes = syntaxNodes(doc);

    expect(nodes.map((node) => node.name)).toContain('Wikilink');
    expect(nodes.map((node) => node.name)).toContain('WikilinkTarget');
    expect(nodes.map((node) => node.name)).toContain('WikilinkAliasSeparator');
    expect(nodes.map((node) => node.name)).toContain('WikilinkAlias');
  });

  it('parses an empty link so autocomplete can activate', () => {
    expect(syntaxNodes('[[]]').map((node) => node.name)).toContain('Wikilink');
  });

  it('does not parse image embeds, inline code, or fenced code as wikilinks', () => {
    const doc = '![[image.png]] and `[[inline]]`\n\n```\n[[fenced]]\n```';
    expect(syntaxNodes(doc).map((node) => node.name)).not.toContain('Wikilink');
  });
});

describe('wikilink alias decorations', () => {
  const doc = 'before [[some long name|shortname]] after';
  const from = doc.indexOf('[[');
  const to = doc.indexOf(']]') + 2;
  const targetFrom = from + 2;
  const aliasFrom = doc.indexOf('|') + 1;

  it('conceals only the target and pipe while inactive', () => {
    const specs = decorationSpecs(doc, 0);

    expect(specs).toContainEqual({
      from,
      to,
      class: 'gn-wikilink',
      isAtomic: false
    });
    expect(specs).toContainEqual({
      from: targetFrom,
      to: aliasFrom,
      class: undefined,
      isAtomic: true
    });
  });

  it('reveals the full source while the cursor is inside the link', () => {
    const specs = decorationSpecs(doc, aliasFrom);

    expect(specs).toEqual([
      {
        from,
        to,
        class: 'gn-wikilink',
        isAtomic: false
      }
    ]);
  });

  it('conceals alias padding so the rendered name has no surrounding spaces', () => {
    const padded = '[[target| short name ]]';
    const specs = decorationSpecs(padded, padded.length);

    expect(specs.filter((spec) => spec.isAtomic)).toEqual([
      { from: 2, to: 10, class: undefined, isAtomic: true },
      { from: 20, to: 21, class: undefined, isAtomic: true }
    ]);
  });

  it('keeps an unaliased wikilink visible', () => {
    const plainDoc = '[[ordinary note]]';
    const specs = decorationSpecs(plainDoc, plainDoc.length);

    expect(specs).toEqual([
      {
        from: 0,
        to: plainDoc.length,
        class: 'gn-wikilink',
        isAtomic: false
      }
    ]);
  });
});

describe('getWikilinkAtPosition', () => {
  it('resolves the complete raw target from a position in the visible alias', () => {
    const doc = '[[long target|short]]';
    const state = createState(doc);

    expect(getWikilinkAtPosition(state, doc.indexOf('short') + 2)).toEqual({
      from: 0,
      to: doc.length,
      rawTarget: 'long target|short'
    });
  });

  it('does not resolve image embeds or code', () => {
    const doc = '![[image.png]] `[[code]]`';
    const state = createState(doc);

    expect(getWikilinkAtPosition(state, doc.indexOf('image'))).toBeNull();
    expect(getWikilinkAtPosition(state, doc.indexOf('code'))).toBeNull();
  });

  it('does not resolve a cursor immediately after the link', () => {
    const doc = '[[target]] after';
    expect(getWikilinkAtPosition(createState(doc), '[[target]]'.length)).toBeNull();
  });
});
