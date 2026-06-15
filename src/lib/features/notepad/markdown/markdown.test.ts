import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type Range } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { decorateBlockquote } from './decorations/blockquote';
import { decorateCodeBlocks } from './decorations/codeBlocks';
import { decorateHeading } from './decorations/headings';
import { decorateHorizontalRule } from './decorations/horizontalRule';
import { decorateInlineFormatting } from './decorations/inlineFormatting';
import { decorateLink } from './decorations/links';
import { decorateList } from './decorations/lists';
import type { MarkdownNodeDecorator } from './decorations/types';

// These tests exercise the decoration builders directly against a real Lezer
// markdown syntax tree, without mounting an EditorView (the test environment is
// node, no DOM). Each decorator only reads `ctx.view.state` and `node.node`, so
// a minimal fake context backed by an EditorState is sufficient. `overlap`
// controls the conceal/reveal branch that the view plugin normally derives from
// the live selection.

interface DecorationSpec {
  from: number;
  to: number;
  class?: string;
  isReplace: boolean;
  hasWidget: boolean;
}

function collect(
  doc: string,
  decorator: MarkdownNodeDecorator,
  overlap: (from: number, to: number) => boolean = () => false
): DecorationSpec[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })]
  });

  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) {
    throw new Error('failed to parse markdown for test');
  }

  const decorations: Range<Decoration>[] = [];
  const ctx = {
    view: { state } as never,
    decorations,
    selectionOverlaps: overlap
  };

  tree.iterate({
    enter: (node) => decorator(ctx, node)
  });

  return decorations.map((range) => {
    const spec = range.value.spec as { class?: string; widget?: unknown };
    return {
      from: range.from,
      to: range.to,
      class: spec.class,
      // Replace decorations report point/inclusive sides; detect them by the
      // absence of a class and (for atomic markers) presence of a widget, or by
      // the documented startSide of replace decorations.
      isReplace: spec.class === undefined,
      hasWidget: spec.widget !== undefined
    };
  });
}

function classes(specs: DecorationSpec[]): (string | undefined)[] {
  return specs.map((s) => s.class);
}

describe('heading decorator', () => {
  it('adds a level line class and conceals the marker when not editing', () => {
    const specs = collect('## Title', decorateHeading);
    expect(classes(specs)).toContain('cm-gn-line-h2');
    // The `## ` marker (including trailing space) is concealed via replace.
    const conceal = specs.find((s) => s.isReplace);
    expect(conceal).toBeDefined();
    expect(conceal!.from).toBe(0);
    expect(conceal!.to).toBe(3);
  });

  it('reveals the marker with a class when the selection overlaps', () => {
    const specs = collect('# Title', decorateHeading, () => true);
    expect(classes(specs)).toContain('cm-gn-line-h1');
    expect(classes(specs)).toContain('cm-gn-header-mark');
    expect(specs.some((s) => s.isReplace)).toBe(false);
  });
});

describe('inline formatting decorator', () => {
  it('marks strong content and conceals both emphasis markers', () => {
    const specs = collect('a **bold** b', decorateInlineFormatting);
    expect(classes(specs)).toContain('cm-gn-strong');
    const conceals = specs.filter((s) => s.isReplace);
    expect(conceals).toHaveLength(2);
  });

  it('keeps emphasis markers visible when the selection overlaps', () => {
    const specs = collect('_italic_', decorateInlineFormatting, () => true);
    expect(classes(specs)).toContain('cm-gn-emphasis');
    expect(specs.some((s) => s.isReplace)).toBe(false);
  });

  it('handles strikethrough', () => {
    const specs = collect('~~gone~~', decorateInlineFormatting);
    expect(classes(specs)).toContain('cm-gn-strikethrough');
  });
});

describe('list decorator', () => {
  it('adds an unordered list line class and a bullet marker', () => {
    const specs = collect('- item', decorateList);
    expect(classes(specs)).toContain('cm-gn-list-line-ul');
    expect(classes(specs)).toContain('cm-gn-list-mark-ul');
  });

  it('adds an ordered list line class', () => {
    const specs = collect('1. item', decorateList);
    expect(classes(specs)).toContain('cm-gn-list-line-ol');
    expect(classes(specs)).toContain('cm-gn-list-mark-ol');
  });

  it('renders a task checkbox widget when not editing', () => {
    const specs = collect('- [x] done', decorateList);
    expect(classes(specs)).toContain('cm-gn-task-line');
    expect(specs.some((s) => s.hasWidget)).toBe(true);
  });

  it('shows the raw task marker when the selection overlaps', () => {
    const specs = collect('- [ ] todo', decorateList, () => true);
    expect(classes(specs)).toContain('cm-gn-task-marker');
    expect(specs.some((s) => s.hasWidget)).toBe(false);
  });

  it('marks the active list marker when editing', () => {
    const specs = collect('- item', decorateList, () => true);
    expect(specs.some((s) => s.class === 'cm-gn-list-mark-ul cm-gn-active')).toBe(true);
  });
});

describe('code block decorator', () => {
  it('marks inline code and conceals its backticks', () => {
    const specs = collect('text `code` text', decorateCodeBlocks);
    expect(classes(specs)).toContain('cm-gn-code-inline');
    expect(specs.filter((s) => s.isReplace)).toHaveLength(2);
  });

  it('decorates fenced code lines and conceals the fences', () => {
    const specs = collect('```js\nconst x = 1;\n```', decorateCodeBlocks);
    expect(classes(specs)).toContain('cm-gn-code-block-line');
    expect(classes(specs)).toContain('cm-gn-code-block-line-start');
    expect(classes(specs)).toContain('cm-gn-code-block-line-end');
    // Opening and closing fences are concealed when not editing.
    expect(specs.some((s) => s.isReplace)).toBe(true);
  });
});

describe('blockquote decorator', () => {
  it('adds quote line + content and conceals the marker', () => {
    const specs = collect('> quoted', decorateBlockquote);
    expect(classes(specs)).toContain('cm-gn-quote-line');
    expect(classes(specs)).toContain('cm-gn-quote-content');
    expect(specs.some((s) => s.isReplace)).toBe(true);
  });
});

describe('horizontal rule decorator', () => {
  it('adds the hr line class and conceals the markers', () => {
    const specs = collect('---', decorateHorizontalRule);
    expect(classes(specs)).toContain('cm-gn-hr-line');
    expect(specs.some((s) => s.isReplace)).toBe(true);
  });
});

describe('link decorator', () => {
  it('replaces a link with a styled widget when not editing', () => {
    const specs = collect('[label](https://example.com)', decorateLink);
    expect(specs.some((s) => s.hasWidget)).toBe(true);
  });

  it('reveals raw link markers when the selection overlaps', () => {
    const specs = collect('[label](https://example.com)', decorateLink, () => true);
    expect(classes(specs)).toContain('cm-gn-link-marker');
    expect(classes(specs)).toContain('cm-gn-link-url');
    expect(specs.some((s) => s.hasWidget)).toBe(false);
  });
});
