import { Decoration } from '@codemirror/view';
import {
  emphasisWrapFormats
} from '../inlineFormatSpec';
import type { MarkdownDecorationContext, MarkdownNodeDecorator } from './types';

// Inline emphasis nodes → in-place styling. Content gets a mark decoration; the
// surrounding markers (**, *, _, ~~, ==) are concealed with a replace decoration
// unless the selection overlaps the node, in which case the raw markers are
// shown so they can be edited.
const CONTENT_MARKS = Object.fromEntries(
  emphasisWrapFormats.map((spec) => [
    spec.syntaxNode,
    Decoration.mark({ class: spec.contentClass })
  ])
) as Record<string, Decoration>;

const MARKER_NAMES = Object.fromEntries(
  emphasisWrapFormats.map((spec) => [spec.syntaxNode, spec.markerNode])
) as Record<string, string>;

const concealMark = Decoration.replace({});

function concealMarkers(
  ctx: MarkdownDecorationContext,
  node: { from: number; to: number; node: { getChildren: (name: string) => Iterable<{ from: number; to: number }> } },
  markerName: string
) {
  for (const marker of node.node.getChildren(markerName)) {
    if (marker.to > marker.from) {
      ctx.decorations.push(concealMark.range(marker.from, marker.to));
    }
  }
}

export const decorateInlineFormatting: MarkdownNodeDecorator = (
  ctx: MarkdownDecorationContext,
  node
) => {
  const { from, to } = node;

  if (node.name === 'Escape') {
    if (!ctx.selectionOverlaps(from, to) && to > from) {
      ctx.decorations.push(concealMark.range(from, from + 1));
    }
    return;
  }

  const contentMark = CONTENT_MARKS[node.name];
  if (!contentMark) {
    return;
  }

  ctx.decorations.push(contentMark.range(from, to));

  if (ctx.selectionOverlaps(from, to)) {
    return;
  }

  concealMarkers(ctx, node, MARKER_NAMES[node.name]);
};
