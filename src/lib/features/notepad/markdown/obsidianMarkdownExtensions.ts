import { commentMarkdownExtension } from './commentExtension';
import { highlightMarkdownExtension } from './highlightExtension';
import { wikilinkMarkdownExtension } from './wikilinkExtension';

/** Obsidian-style inline syntax layered on GFM (wikilinks, highlight, comments, …). */
export const obsidianMarkdownExtensions = {
  defineNodes: [
    ...wikilinkMarkdownExtension.defineNodes!,
    ...highlightMarkdownExtension.defineNodes,
    ...commentMarkdownExtension.defineNodes
  ],
  parseInline: [
    ...wikilinkMarkdownExtension.parseInline!,
    ...highlightMarkdownExtension.parseInline,
    ...commentMarkdownExtension.parseInline
  ]
};
