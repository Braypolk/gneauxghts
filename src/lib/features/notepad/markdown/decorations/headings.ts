import { Decoration } from '@codemirror/view';
import type { MarkdownNodeDecorator } from './types';

const HEADING_LEVELS: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6
};

const lineDecorations = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-gn-line-h${level}` })
);

// Visible styling for the leading `#` marker when the heading is being edited.
const headerMarkActive = Decoration.mark({ class: 'cm-gn-header-mark' });
const headerMarkConceal = Decoration.replace({});

export const decorateHeading: MarkdownNodeDecorator = (ctx, node) => {
  const level = HEADING_LEVELS[node.name];
  if (!level) {
    return;
  }

  const { view, decorations } = ctx;
  const line = view.state.doc.lineAt(node.from);
  decorations.push(lineDecorations[level - 1].range(line.from));

  const headerMark = node.node.getChild('HeaderMark');
  if (!headerMark) {
    return;
  }

  // Include the space after the `#`s so concealing the marker also removes the
  // gap; clamp to the line so a replace never spans a newline.
  const markEnd = Math.min(headerMark.to + 1, line.to);
  if (ctx.selectionOverlaps(node.from, node.to)) {
    decorations.push(headerMarkActive.range(headerMark.from, markEnd));
  } else {
    decorations.push(headerMarkConceal.range(headerMark.from, markEnd));
  }
};
