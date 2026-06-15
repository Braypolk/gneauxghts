import { Decoration } from '@codemirror/view';
import type { MarkdownNodeDecorator } from './types';

// Thematic breaks (---, ***, ___): a line decoration renders a centered rule;
// the raw marker characters are concealed unless the cursor is on the line.

const hrLine = Decoration.line({ class: 'cm-gn-hr-line' });
const concealMark = Decoration.replace({});

export const decorateHorizontalRule: MarkdownNodeDecorator = (ctx, node) => {
  if (node.name !== 'HorizontalRule') {
    return;
  }

  const { view, decorations } = ctx;
  const line = view.state.doc.lineAt(node.from);
  decorations.push(hrLine.range(line.from));

  if (!ctx.selectionOverlaps(node.from, node.to)) {
    const markEnd = Math.min(node.to, line.to);
    if (markEnd > node.from) {
      decorations.push(concealMark.range(node.from, markEnd));
    }
  }
};
