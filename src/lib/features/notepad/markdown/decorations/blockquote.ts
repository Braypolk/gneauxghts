import { Decoration } from '@codemirror/view';
import type { MarkdownNodeDecorator } from './types';
import { forEachVisibleLine } from './types';

// Blockquotes: a left-border line decoration per quoted line, italic content,
// and concealed `>` markers unless the selection touches the quote.

const quoteLine = Decoration.line({ class: 'cm-gn-quote-line' });
const quoteContent = Decoration.mark({ class: 'cm-gn-quote-content' });
const concealMark = Decoration.replace({});

export const decorateBlockquote: MarkdownNodeDecorator = (ctx, node) => {
  // The traversal already visits visible markers. Recursively scanning all
  // children here would undo the viewport bound (and duplicate nested marks).
  // Preserve the existing treatment of continuation markers inside Paragraphs.
  if (node.name === 'QuoteMark' && node.node.parent?.name === 'Blockquote') {
    const quote = node.node.parent;
    if (!ctx.selectionOverlaps(quote.from, quote.to)) {
      const end = Math.min(node.to + 1, ctx.view.state.doc.lineAt(node.from).to);
      if (end > node.from) ctx.decorations.push(concealMark.range(node.from, end));
    }
    return;
  }
  if (node.name !== 'Blockquote') {
    return;
  }

  const { decorations } = ctx;
  forEachVisibleLine(ctx, node.from, node.to, (line) => {
    decorations.push(quoteLine.range(line.from));
  });

  decorations.push(quoteContent.range(node.from, node.to));
};
