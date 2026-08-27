import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState, Transaction, type Range, type TransactionSpec } from '@codemirror/state';
import type { Decoration, EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { decorateBlockquote } from './decorations/blockquote';
import { decorateCodeBlocks } from './decorations/codeBlocks';
import { decorateHeading } from './decorations/headings';
import { decorateHorizontalRule } from './decorations/horizontalRule';
import { decorateInlineFormatting } from './decorations/inlineFormatting';
import { decorateLink } from './decorations/links';
import { decorateList, toggleTaskMarker } from './decorations/lists';
import type { MarkdownNodeDecorator } from './decorations/types';
import { markdownDecorationsNeedRebuild } from './markdownExtensions';
import { obsidianMarkdownExtensions } from './obsidianMarkdownExtensions';

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
  widgetChecked?: boolean;
  isAtomicIndent: boolean;
  style?: string;
}

function collect(
  doc: string,
  decorator: MarkdownNodeDecorator,
  overlap: (from: number, to: number) => boolean = () => false,
  selection?: { anchor: number; head: number }
): DecorationSpec[] {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage, extensions: obsidianMarkdownExtensions })]
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
    const spec = range.value.spec as {
      class?: string;
      widget?: unknown;
      gnAtomicIndent?: boolean;
    };
    return {
      from: range.from,
      to: range.to,
      class: spec.class,
      // Replace decorations report point/inclusive sides; detect them by the
      // absence of a class and (for atomic markers) presence of a widget, or by
      // the documented startSide of replace decorations.
      isReplace: spec.class === undefined,
      hasWidget: spec.widget !== undefined,
      widgetChecked:
        spec.widget && typeof spec.widget === 'object' && 'checked' in spec.widget
          ? Boolean(spec.widget.checked)
          : undefined,
      style: (spec as { attributes?: { style?: string } }).attributes?.style,
      isAtomicIndent: spec.gnAtomicIndent === true
    };
  });
}

function classes(specs: DecorationSpec[]): (string | undefined)[] {
  return specs.map((s) => s.class);
}

describe('markdown decoration lifecycle', () => {
  it('rebuilds when background parsing publishes a more complete syntax tree', () => {
    const doc = Array.from(
      { length: 2_000 },
      (_, index) => `## Heading ${index} with **bold** text`
    ).join('\n\n');
    const startState = EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: obsidianMarkdownExtensions })
      ]
    });
    const initialTree = syntaxTree(startState);

    // CodeMirror's initial synchronous parse is viewport-sized. Its background
    // worker later advances the mutable parse context and publishes it through
    // a transaction that changes neither the document nor the selection.
    expect(initialTree.length).toBeLessThan(doc.length);
    expect(ensureSyntaxTree(startState, doc.length, 5_000)?.length).toBe(doc.length);
    const state = startState.update({}).state;

    expect(
      markdownDecorationsNeedRebuild({
        docChanged: false,
        selectionSet: false,
        viewportChanged: false,
        startState,
        state
      })
    ).toBe(true);
  });
});

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

  it('renders underscore and asterisk italics', () => {
    expect(classes(collect('_italic_', decorateInlineFormatting))).toContain('cm-gn-emphasis');
    expect(classes(collect('*Italic text*', decorateInlineFormatting))).toContain('cm-gn-emphasis');
  });

  it('renders underscore bold markers', () => {
    expect(classes(collect('__Bold text__', decorateInlineFormatting))).toContain('cm-gn-strong');
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

  it('handles highlight markers', () => {
    const specs = collect('==Highlighted text==', decorateInlineFormatting);
    expect(classes(specs)).toContain('cm-gn-highlight');
    expect(specs.filter((s) => s.isReplace)).toHaveLength(2);
  });

  it('lets a non-empty selection own the highlight fill', () => {
    const selected = collect(
      '==Highlighted text==',
      decorateInlineFormatting,
      () => true,
      { anchor: 2, head: 10 }
    );
    const caretOnly = collect(
      '==Highlighted text==',
      decorateInlineFormatting,
      () => true,
      { anchor: 5, head: 5 }
    );

    expect(classes(selected)).toContain(
      'cm-gn-highlight cm-gn-selection-overlap'
    );
    expect(classes(caretOnly)).toContain('cm-gn-highlight');
    expect(classes(caretOnly)).not.toContain(
      'cm-gn-highlight cm-gn-selection-overlap'
    );
  });

  it('handles Obsidian comment markers', () => {
    const specs = collect('Visible %%hidden note%% text', decorateInlineFormatting);
    expect(classes(specs)).toContain('cm-gn-comment');
    expect(specs.filter((s) => s.isReplace)).toHaveLength(2);
  });

  it('supports nested bold and italic', () => {
    const specs = collect('**Bold text and _nested italic_ text**', decorateInlineFormatting);
    expect(classes(specs)).toContain('cm-gn-strong');
    expect(classes(specs)).toContain('cm-gn-emphasis');
  });

  it('supports bold and italic with triple markers', () => {
    const specs = collect('***Bold and italic text***', decorateInlineFormatting);
    expect(classes(specs)).toContain('cm-gn-strong');
    expect(classes(specs)).toContain('cm-gn-emphasis');
  });

  it('conceals escape backslashes when not editing', () => {
    const specs = collect(String.raw`\*\*This line will not be bold\*\*`, decorateInlineFormatting);
    expect(classes(specs)).not.toContain('cm-gn-strong');
    expect(specs.filter((s) => s.isReplace)).toHaveLength(4);
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
    const unchecked = collect('- [ ] todo', decorateList);
    const specs = collect('- [x] done', decorateList);
    expect(classes(specs)).toContain('cm-gn-task-line');
    expect(specs).toContainEqual(
      expect.objectContaining({ from: 0, to: 2, isReplace: true, hasWidget: false })
    );
    expect(classes(specs)).not.toContain('cm-gn-list-mark-ul');
    expect(unchecked.find((s) => s.hasWidget)?.widgetChecked).toBe(false);
    expect(specs.find((s) => s.hasWidget)?.widgetChecked).toBe(true);
  });

  it('shows the raw task marker when the selection overlaps', () => {
    const specs = collect('- [ ] todo', decorateList, () => true);
    expect(classes(specs)).toContain('cm-gn-task-marker');
    expect(classes(specs)).toContain('cm-gn-list-mark-ul cm-gn-active');
    expect(specs.some((s) => s.hasWidget)).toBe(false);
  });

  it('marks the active list marker when editing', () => {
    const specs = collect('- item', decorateList, () => true);
    expect(specs.some((s) => s.class === 'cm-gn-list-mark-ul cm-gn-active')).toBe(true);
  });

  it('conceals nested-list indentation as an atomic range', () => {
    const specs = collect('- parent\n  - child', decorateList);
    const indent = specs.find((spec) => spec.isAtomicIndent);

    expect(indent).toMatchObject({ from: 9, to: 11, isReplace: true });
  });

  it('keeps nested tasks visually identified as list items', () => {
    const specs = collect('- parent\n  - [ ] nested task', decorateList);

    expect(classes(specs)).toContain('cm-gn-task-line');
    expect(specs.some((spec) => spec.style === '--gn-depth: 1')).toBe(true);
    expect(specs).toContainEqual(
      expect.objectContaining({ from: 11, to: 13, isReplace: true, hasWidget: false })
    );
  });

  it('toggles a task marker as one undoable source edit', () => {
    let state = EditorState.create({ doc: '- [ ] todo', extensions: [history()] });
    const view = {
      get state() {
        return state;
      },
      dispatch(spec: Transaction | TransactionSpec) {
        const transaction =
          spec instanceof Transaction ? spec : state.update(spec);
        state = transaction.state;
      }
    } as unknown as EditorView;

    expect(toggleTaskMarker(view, 4, false)).toBe(true);
    expect(state.doc.toString()).toBe('- [x] todo');
    expect(undo(view)).toBe(true);
    expect(state.doc.toString()).toBe('- [ ] todo');
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
