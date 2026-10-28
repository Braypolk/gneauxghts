import type { Line, MarkdownConfig } from '@lezer/markdown';
import { tags } from '@lezer/highlight';

// Lowercase alphabetic enumerators, following the familiar fancy-list syntax.
// Cap the marker length so ordinary sentences ending in a period stay prose.
export const letterListPrefix = /^([\t ]*)([a-z]{1,3})\.([\t ]+)/;

export function letterListLabel(index: number): string {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(97 + (value - 1) % 26) + label;
  }
  return label;
}

function markerSize(line: Line): number {
  return /^[a-z]{1,3}\.(?=[\t ]|$)/.exec(line.text.slice(line.pos))?.[0].length ?? 0;
}

export const letterListExtension: MarkdownConfig = {
  defineNodes: [{
    name: 'LetterList',
    block: true,
    style: tags.list,
    composite(_cx, line) {
      // ListItem itself validates the actual content indentation. Three columns
      // is the shortest letter prefix; longer markers (aa.) still nest normally.
      return line.pos === line.text.length || line.indent >= line.baseIndent + 3 ||
        line.indent < line.baseIndent + 4 && markerSize(line) > 0;
    }
  }],
  parseBlock: [{
    name: 'LetterList',
    after: 'OrderedList',
    parse(cx, line) {
      const size = markerSize(line);
      if (!size) return false;
      if (cx.parentType().name !== 'LetterList') cx.startComposite('LetterList', line.basePos);
      const markerEnd = line.pos + size;
      const afterMarker = line.countIndent(markerEnd);
      const contentPos = line.skipSpace(markerEnd);
      const contentIndent = line.countIndent(contentPos);
      const newBase = contentPos === line.text.length || contentIndent >= afterMarker + 5
        ? afterMarker + 1 : contentIndent;
      cx.startComposite('ListItem', line.basePos, newBase - line.baseIndent);
      cx.addElement(cx.elt('ListMark', cx.lineStart + line.pos, cx.lineStart + markerEnd));
      line.moveBaseColumn(newBase);
      return null;
    },
    endLeaf(cx, line) {
      // As with decimal lists, only the first enumerator interrupts prose.
      const text = line.text.slice(line.pos);
      const letter = markerSize(line) > 0;
      if (letter && /^a\.[\t ]+\S/.test(text)) return true;
      // Changing a sibling's marker style must not turn following `2.` or
      // `b.` items into lazy paragraph text. Mixed lists retain their levels.
      if (!letter && !/^\d{1,9}[.)](?=[\t ]|$)/.test(text)) return false;
      for (let depth = cx.depth - 1; depth > 0; depth--) {
        if (cx.parentType(depth).name === 'ListItem') return true;
      }
      return false;
    }
  }]
};
