import { tags } from '@lezer/highlight';

// Matches @lezer/markdown's internal punctuation test used by GFM strikethrough.
export const punctuationPattern = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1\u2010-\u2027]/u;

const highlightDelimiter = { resolve: 'Highlight', mark: 'HighlightMark' };

interface HighlightInlineContext {
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
 * Obsidian-style highlight syntax using `==` delimiters.
 */
export const highlightMarkdownExtension = {
  defineNodes: [
    {
      name: 'Highlight',
      style: { 'Highlight/...': tags.special(tags.content) }
    },
    {
      name: 'HighlightMark',
      style: tags.processingInstruction
    }
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx: HighlightInlineContext, next: number, pos: number) {
        if (next !== 61 /* '=' */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) {
          return -1;
        }

        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = punctuationPattern.test(before);
        const punctAfter = punctuationPattern.test(after);

        return cx.addDelimiter(
          highlightDelimiter,
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
