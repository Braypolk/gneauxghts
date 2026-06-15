import { Decoration } from '@codemirror/view';
import type { MarkdownDecorationContext, MarkdownNodeDecorator } from './types';

// Inline emphasis nodes → in-place styling. Content gets a mark decoration; the
// surrounding markers (**, *, _, ~~) are concealed with a replace decoration
// unless the selection overlaps the node, in which case the raw markers are
// shown so they can be edited.
const CONTENT_MARKS = {
  Emphasis: Decoration.mark({ class: 'cm-gn-emphasis' }),
  StrongEmphasis: Decoration.mark({ class: 'cm-gn-strong' }),
  Strikethrough: Decoration.mark({ class: 'cm-gn-strikethrough' })
} as const;

const MARKER_NAMES: Record<keyof typeof CONTENT_MARKS, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark'
};

const concealMark = Decoration.replace({});

export const decorateInlineFormatting: MarkdownNodeDecorator = (
  ctx: MarkdownDecorationContext,
  node
) => {
  const contentMark = CONTENT_MARKS[node.name as keyof typeof CONTENT_MARKS];
  if (!contentMark) {
    return;
  }

  const { from, to } = node;
  ctx.decorations.push(contentMark.range(from, to));

  if (ctx.selectionOverlaps(from, to)) {
    return;
  }

  const markerName = MARKER_NAMES[node.name as keyof typeof CONTENT_MARKS];
  for (const marker of node.node.getChildren(markerName)) {
    if (marker.to > marker.from) {
      ctx.decorations.push(concealMark.range(marker.from, marker.to));
    }
  }
};
