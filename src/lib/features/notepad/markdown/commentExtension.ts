import { tags } from '@lezer/highlight';

interface CommentInlineContext {
  char(pos: number): number;
  readonly end: number;
  elt(name: string, from: number, to: number, children?: readonly unknown[]): unknown;
  addElement(element: unknown): number;

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

        for (let end = pos + 2; end + 1 < cx.end; end++) {
          if (cx.char(end) === 37 && cx.char(end + 1) === 37) {
            return cx.addElement(cx.elt('InlineComment', pos, end + 2, [
              cx.elt('InlineCommentMark', pos, pos + 2),
              cx.elt('InlineCommentMark', end, end + 2)
            ]));
          }
        }
        return -1;
      },
      after: 'Emphasis'
    }
  ]
};
