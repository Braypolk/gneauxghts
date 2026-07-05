import { Decoration } from '@codemirror/view';
import { getWrapFormatSpec } from '../inlineFormatSpec';
import type { MarkdownNodeDecorator } from './types';

// Inline code (`code`) and fenced code blocks. Syntax highlighting of the
// fenced body is handled by lang-markdown's nested parsing + markdownHighlight;
// this decorator only supplies the visual chrome: an inline-code background,
// per-line block styling, and conceal of the backtick fences / info string when
// the block is not being edited.

const codeSpec = getWrapFormatSpec('code');
const inlineCodeMark = Decoration.mark({ class: codeSpec.contentClass });
const conceal = Decoration.replace({});
const codeFenceMark = Decoration.mark({ class: 'cm-gn-code-fence' });
const codeBlockLine = Decoration.line({ class: 'cm-gn-code-block-line' });
const codeBlockLineStart = Decoration.line({ class: 'cm-gn-code-block-line-start' });
const codeBlockLineEnd = Decoration.line({ class: 'cm-gn-code-block-line-end' });

export const decorateCodeBlocks: MarkdownNodeDecorator = (ctx, node) => {
  if (node.name === 'InlineCode') {
    decorateInline(ctx, node);
    return;
  }
  if (node.name === 'FencedCode') {
    decorateFenced(ctx, node);
  }
};

const decorateInline: MarkdownNodeDecorator = (ctx, node) => {
  const { from, to } = node;
  ctx.decorations.push(inlineCodeMark.range(from, to));

  if (ctx.selectionOverlaps(from, to)) {
    return;
  }

  for (let child = node.node.firstChild; child; child = child.nextSibling) {
    if (child.name === codeSpec.markerNode && child.to > child.from) {
      ctx.decorations.push(conceal.range(child.from, child.to));
    }
  }
};

const decorateFenced: MarkdownNodeDecorator = (ctx, node) => {
  const { view, decorations } = ctx;
  const startLine = view.state.doc.lineAt(node.from);
  const endLine = view.state.doc.lineAt(node.to);
  const active = ctx.selectionOverlaps(startLine.from, endLine.to);

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
    const line = view.state.doc.line(lineNumber);
    decorations.push(codeBlockLine.range(line.from));
    if (lineNumber === startLine.number) {
      decorations.push(codeBlockLineStart.range(line.from));
    }
    if (lineNumber === endLine.number) {
      decorations.push(codeBlockLineEnd.range(line.from));
    }
  }

  // Conceal the opening/closing fences and the info string unless editing.
  for (let child = node.node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeMark' || child.name === 'CodeInfo') {
      if (child.to > child.from) {
        decorations.push((active ? codeFenceMark : conceal).range(child.from, child.to));
      }
    }
  }
};
