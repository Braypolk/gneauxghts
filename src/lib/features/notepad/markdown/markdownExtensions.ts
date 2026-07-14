import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';

import { selectionOverlaps } from './conceal';
import { createMarkdownHighlight } from './markdownHighlight';
import { createMarkdownLanguage } from './markdownLanguage';
import { decorateBlockquote } from './decorations/blockquote';
import { decorateCodeBlocks } from './decorations/codeBlocks';
import { decorateHeading } from './decorations/headings';
import { decorateHorizontalRule } from './decorations/horizontalRule';
import { decorateInlineFormatting } from './decorations/inlineFormatting';
import { decorateLink } from './decorations/links';
import { decorateList } from './decorations/lists';
import type { MarkdownDecorationContext, MarkdownNodeDecorator } from './decorations/types';

// Ordered list of per-concern decorators. The view plugin walks the syntax tree
// once and hands every node to each decorator; matching on node name is each
// decorator's own responsibility. Order here only affects the sequence in which
// ranges are pushed — final ordering is resolved by the position sort below, so
// overlapping decorations remain stable.
const DECORATORS: readonly MarkdownNodeDecorator[] = [
  decorateHeading,
  decorateInlineFormatting,
  decorateCodeBlocks,
  decorateList,
  decorateBlockquote,
  decorateHorizontalRule,
  decorateLink
];

interface BuiltMarkdownDecorations {
  decorations: DecorationSet;
  atomicIndents: DecorationSet;
}

function buildDecorations(view: EditorView): BuiltMarkdownDecorations {
  const decorations: Range<Decoration>[] = [];
  const ctx: MarkdownDecorationContext = {
    view,
    decorations,
    selectionOverlaps: (from, to) => selectionOverlaps(view, from, to)
  };

  const tree = syntaxTree(view.state);
  tree.iterate({
    enter: (node) => {
      for (const decorate of DECORATORS) {
        try {
          decorate(ctx, node);
        } catch {
          // Partial/incremental tree states can momentarily yield invalid node
          // offsets; these resolve on the next update cycle, so skip quietly.
        }
      }
    }
  });

  decorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);

  const builder = new RangeSetBuilder<Decoration>();
  for (const decoration of decorations) {
    builder.add(decoration.from, decoration.to, decoration.value);
  }
  return {
    decorations: builder.finish(),
    atomicIndents: Decoration.set(
      decorations.filter((range) => range.value.spec.gnAtomicIndent === true),
      true
    )
  };
}

const markdownDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomicIndents: DecorationSet;

    constructor(view: EditorView) {
      const built = buildDecorations(view);
      this.decorations = built.decorations;
      this.atomicIndents = built.atomicIndents;
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        const built = buildDecorations(update.view);
        this.decorations = built.decorations;
        this.atomicIndents = built.atomicIndents;
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
);

// Marks the editor so the scoped `cm-gn-*` styling in editor.css applies.
const markdownEditorClass = EditorView.editorAttributes.of({ class: 'cm-gn' });

// The single seam that replaces draftly. Returns the markdown language support,
// the in-place decoration plugin, and syntax highlighting for fenced code. Line
// wrapping and history are owned by the editor module, not here, so this bundle
// can be dropped into both the root state and each pane view.
export function createMarkdownExtensions(): Extension[] {
  return [
    markdownEditorClass,
    createMarkdownLanguage(),
    createMarkdownHighlight(),
    markdownDecorationPlugin,
    EditorView.atomicRanges.of(
      (view) => view.plugin(markdownDecorationPlugin)?.atomicIndents ?? Decoration.none
    )
  ];
}
