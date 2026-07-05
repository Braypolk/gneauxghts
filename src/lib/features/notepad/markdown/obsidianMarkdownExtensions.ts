import { commentMarkdownExtension } from './commentExtension';
import { highlightMarkdownExtension } from './highlightExtension';

/** Obsidian-style inline syntax layered on GFM (highlight, comments, …). */
export const obsidianMarkdownExtensions = {
  defineNodes: [
    ...highlightMarkdownExtension.defineNodes,
    ...commentMarkdownExtension.defineNodes
  ],
  parseInline: [
    ...highlightMarkdownExtension.parseInline,
    ...commentMarkdownExtension.parseInline
  ]
};
