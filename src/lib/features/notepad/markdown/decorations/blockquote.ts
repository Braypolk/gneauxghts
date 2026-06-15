import { Decoration } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { EditorView } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import type { MarkdownNodeDecorator } from './types';

// Blockquotes: a left-border line decoration per quoted line, italic content,
// and concealed `>` markers unless the selection touches the quote.

const quoteLine = Decoration.line({ class: 'cm-gn-quote-line' });
const quoteContent = Decoration.mark({ class: 'cm-gn-quote-content' });
const concealMark = Decoration.replace({});

function concealQuoteMarks(
  node: SyntaxNode,
  view: EditorView,
  decorations: Range<Decoration>[]
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'QuoteMark') {
      const line = view.state.doc.lineAt(child.from);
      const markEnd = Math.min(child.to + 1, line.to);
      if (markEnd > child.from) {
        decorations.push(concealMark.range(child.from, markEnd));
      }
    }
    if (child.name === 'Blockquote') {
      concealQuoteMarks(child, view, decorations);
    }
  }
}

export const decorateBlockquote: MarkdownNodeDecorator = (ctx, node) => {
  if (node.name !== 'Blockquote') {
    return;
  }

  const { view, decorations } = ctx;
  const startLine = view.state.doc.lineAt(node.from);
  const endLine = view.state.doc.lineAt(node.to);

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
    decorations.push(quoteLine.range(view.state.doc.line(lineNumber).from));
  }

  decorations.push(quoteContent.range(node.from, node.to));

  if (!ctx.selectionOverlaps(node.from, node.to)) {
    concealQuoteMarks(node.node, view, decorations);
  }
};
