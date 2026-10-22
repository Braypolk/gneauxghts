import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

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
import { decorateWikilink } from './decorations/wikilinks';
import type { MarkdownDecorationContext, MarkdownNodeDecorator } from './decorations/types';
import { createTableExtension } from './tables/tableExtension';
import './tables/table.css';

// Ordered list of per-concern decorators. The view plugin visits visible syntax
// and its enclosing context; each decorator matches its own node names.
// Order here only affects the sequence in which
// ranges are pushed — final ordering is resolved by the position sort below, so
// overlapping decorations remain stable.
const DECORATORS: readonly MarkdownNodeDecorator[] = [
  decorateHeading,
  decorateInlineFormatting,
  decorateCodeBlocks,
  decorateList,
  decorateBlockquote,
  decorateHorizontalRule,
  decorateLink,
  decorateWikilink
];

interface BuiltMarkdownDecorations {
  decorations: DecorationSet;
  atomicRanges: DecorationSet;
}

export function markdownDecorationsNeedRebuild(
  update: Pick<
    ViewUpdate,
    'docChanged' | 'selectionSet' | 'viewportChanged' | 'startState' | 'state'
  >
) {
  return (
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    syntaxTree(update.startState) !== syntaxTree(update.state)
  );
}

export function buildMarkdownDecorations(view: EditorView): BuiltMarkdownDecorations {
  const ranges: { from: number; to: number }[] = [];
  for (const range of [...view.visibleRanges].sort((a, b) => a.from - b.from)) {
    const previous = ranges.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else ranges.push({ ...range });
  }
  const candidates: Range<Decoration>[] = [];
  const ctx: MarkdownDecorationContext = {
    view,
    visibleRanges: ranges,
    decorations: candidates,
    selectionOverlaps: (from, to) => selectionOverlaps(view, from, to)
  };

  const tree = syntaxTree(view.state);
  const visited = new Set<string>();
  for (const range of ranges) {
    function visit(node: SyntaxNode) {
      if (node.from < 0 || node.to > view.state.doc.length) return;
      const key = `${node.name}:${node.type.id}:${node.from}:${node.to}`;
      if (!visited.has(key)) {
        visited.add(key);
        for (const decorate of DECORATORS) decorate(ctx, node);
      }
      // Seek past earlier siblings and stop at the window's end. Tree.iterate
      // with from/to still steps over all later siblings. Always descend shared
      // ancestors in subsequent windows, even when already decorated.
      for (let child = node.childAfter(range.from); child && child.from <= range.to; child = child.nextSibling) {
        visit(child);
      }
    }
    visit(tree.topNode);
  }

  // Context nodes can extend far beyond the viewport. Bound emitted marks too;
  // keep inline replacements whole so widgets/atomic ranges retain their source
  // identity. Line decorations belong at the start of a touching visible line.
  const decorations: Range<Decoration>[] = [];
  for (const candidate of candidates) for (const range of ranges) {
    const beforeWindow = candidate.to < range.from &&
      (candidate.from !== candidate.to || view.state.doc.lineAt(candidate.from).to < range.from);
    if (candidate.from > range.to || beforeWindow) continue;
    if (candidate.value.point) {
      decorations.push(candidate);
      break;
    }
    const from = Math.max(candidate.from, range.from), to = Math.min(candidate.to, range.to);
    if (from < to) decorations.push(candidate.value.range(from, to));
  }

  decorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);

  const builder = new RangeSetBuilder<Decoration>();
  for (const decoration of decorations) {
    builder.add(decoration.from, decoration.to, decoration.value);
  }
  return {
    decorations: builder.finish(),
    atomicRanges: Decoration.set(
      decorations.filter(
        (range) =>
          range.value.spec.gnAtomicIndent === true || range.value.spec.gnAtomic === true
      ),
      true
    )
  };
}

const markdownDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomicRanges: DecorationSet;

    constructor(view: EditorView) {
      const built = buildMarkdownDecorations(view);
      this.decorations = built.decorations;
      this.atomicRanges = built.atomicRanges;
    }

    update(update: ViewUpdate) {
      if (markdownDecorationsNeedRebuild(update)) {
        const built = buildMarkdownDecorations(update.view);
        this.decorations = built.decorations;
        this.atomicRanges = built.atomicRanges;
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
// wrapping and history are owned by the editor module, not here. This bundle
// belongs to pane views; the headless document root has no syntax/presentation.
export function createMarkdownExtensions(): Extension[] {
  return [
    markdownEditorClass,
    createMarkdownLanguage(),
    createMarkdownHighlight(),
    createTableExtension(),
    markdownDecorationPlugin,
    EditorView.atomicRanges.of(
      (view) => view.plugin(markdownDecorationPlugin)?.atomicRanges ?? Decoration.none
    )
  ];
}
