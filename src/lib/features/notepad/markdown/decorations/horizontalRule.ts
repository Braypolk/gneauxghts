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
  const selection = view.state.selection.main;
  // A newly inserted empty bold pair is also valid thematic-break syntax.
  // Keep the typing position plain until it gains content or the caret leaves.
  const markers = view.state.sliceDoc(node.from, node.to);
  if (selection.empty && selection.head === node.from + 2 &&
      (markers === '****' || markers === '____')) {
    return;
  }
  const line = view.state.doc.lineAt(node.from);
  decorations.push(hrLine.range(line.from));

  if (!ctx.selectionOverlaps(node.from, node.to)) {
    const markEnd = Math.min(node.to, line.to);
    if (markEnd > node.from) {
      decorations.push(concealMark.range(node.from, markEnd));
    }
  }
};
