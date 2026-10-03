import { commentMarkdownExtension } from './commentExtension';
import { highlightMarkdownExtension } from './highlightExtension';
import { wikilinkMarkdownExtension } from './wikilinkExtension';
import { imageSyntaxExtension } from './imageSyntaxExtension';

/** Obsidian-style inline syntax layered on GFM (wikilinks, highlight, comments, …). */
export const obsidianMarkdownExtensions = {
  defineNodes: [
    ...imageSyntaxExtension.defineNodes,
    ...wikilinkMarkdownExtension.defineNodes!,
    ...highlightMarkdownExtension.defineNodes,
    ...commentMarkdownExtension.defineNodes
  ],
  parseInline: [
    ...imageSyntaxExtension.parseInline,
    ...wikilinkMarkdownExtension.parseInline!,
    ...highlightMarkdownExtension.parseInline,
    ...commentMarkdownExtension.parseInline
  ]
};
