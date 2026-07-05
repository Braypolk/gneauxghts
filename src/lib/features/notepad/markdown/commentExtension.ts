import { tags } from '@lezer/highlight';

import { punctuationPattern } from './highlightExtension';

const commentDelimiter = { resolve: 'InlineComment', mark: 'InlineCommentMark' };

interface CommentInlineContext {
  char(pos: number): number;
  slice(from: number, to: number): string;
  addDelimiter(
    delim: { resolve: string; mark: string },
    from: number,
    to: number,
    open: boolean,
    close: boolean
  ): number;
}

/**
 * Obsidian-style inline comments using `%%` delimiters.
 * Hidden in Reading view; shown in edit mode with muted styling.
 */
export const commentMarkdownExtension = {
  defineNodes: [
    {
      name: 'InlineComment',
      style: { 'InlineComment/...': tags.comment }
    },
    {
      name: 'InlineCommentMark',
      style: tags.processingInstruction
    }
  ],
  parseInline: [
    {
      name: 'InlineComment',
      parse(cx: CommentInlineContext, next: number, pos: number) {
        if (next !== 37 /* '%' */ || cx.char(pos + 1) !== 37 || cx.char(pos + 2) === 37) {
          return -1;
        }

        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = punctuationPattern.test(before);
        const punctAfter = punctuationPattern.test(after);

        return cx.addDelimiter(
          commentDelimiter,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter)
        );
      },
      after: 'Emphasis'
    }
  ]
};
