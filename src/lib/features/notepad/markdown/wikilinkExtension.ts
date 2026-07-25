import { tags } from '@lezer/highlight';
import { parseWikilink } from '$lib/features/notepad/wikilinks/parse';

interface WikilinkElement {}

interface WikilinkInlineContext {
  char(pos: number): number;
  readonly end: number;
  slice(from: number, to: number): string;
  elt(
    type: string,
    from: number,
    to: number,
    children?: readonly WikilinkElement[]
  ): WikilinkElement;
  addElement(element: WikilinkElement): number;
}

function parseWikilinkNode(cx: WikilinkInlineContext, next: number, pos: number) {
  if (
    next !== 91 /* '[' */ ||
    cx.char(pos + 1) !== 91 ||
    cx.char(pos - 1) === 33 /* '!' */
  ) {
    return -1;
  }

  let closeFrom = -1;
  for (let cursor = pos + 2; cursor + 1 < cx.end; cursor += 1) {
    const character = cx.char(cursor);
    if (character === 10 /* '\n' */ || character === 91 /* '[' */) {
      return -1;
    }
    if (character === 93 /* ']' */ && cx.char(cursor + 1) === 93) {
      closeFrom = cursor;
      break;
    }
    if (character === 93 /* ']' */) {
      return -1;
    }
  }

  if (closeFrom < 0) {
    return -1;
  }

  const innerFrom = pos + 2;
  const rawTarget = cx.slice(innerFrom, closeFrom);
  const parsed = parseWikilink(rawTarget);
  const children = [cx.elt('WikilinkMark', pos, innerFrom)];

  if (parsed.separatorOffset === null) {
    children.push(cx.elt('WikilinkTarget', innerFrom, closeFrom));
  } else {
    const separatorFrom = innerFrom + parsed.separatorOffset;
    const rawAlias = rawTarget.slice(parsed.separatorOffset + 1);
    const aliasLeadingWhitespace = rawAlias.length - rawAlias.trimStart().length;
    const aliasTrailingWhitespace = rawAlias.length - rawAlias.trimEnd().length;
    const aliasFrom = separatorFrom + 1 + aliasLeadingWhitespace;
    const aliasTo = Math.max(aliasFrom, closeFrom - aliasTrailingWhitespace);
    children.push(
      cx.elt('WikilinkTarget', innerFrom, separatorFrom),
      cx.elt('WikilinkAliasSeparator', separatorFrom, separatorFrom + 1)
    );
    if (aliasFrom > separatorFrom + 1) {
      children.push(cx.elt('WikilinkAliasPadding', separatorFrom + 1, aliasFrom));
    }
    children.push(cx.elt('WikilinkAlias', aliasFrom, aliasTo));
    if (closeFrom > aliasTo) {
      children.push(cx.elt('WikilinkAliasPadding', aliasTo, closeFrom));
    }
  }

  children.push(cx.elt('WikilinkMark', closeFrom, closeFrom + 2));
  return cx.addElement(cx.elt('Wikilink', pos, closeFrom + 2, children));
}

/**
 * Obsidian-style `[[target]]` and `[[target|alias]]` links.
 *
 * Parsing these into the Markdown tree lets decorations and interactions use
 * document structure instead of independently scanning raw text.
 */
export const wikilinkMarkdownExtension = {
  defineNodes: [
    {
      name: 'Wikilink',
      style: { 'Wikilink/...': tags.link }
    },
    {
      name: 'WikilinkMark',
      style: tags.processingInstruction
    },
    {
      name: 'WikilinkTarget',
      style: tags.url
    },
    {
      name: 'WikilinkAliasSeparator',
      style: tags.processingInstruction
    },
    {
      name: 'WikilinkAlias',
      style: tags.labelName
    },
    {
      name: 'WikilinkAliasPadding',
      style: tags.processingInstruction
    }
  ],
  parseInline: [
    {
      name: 'Wikilink',
      parse: parseWikilinkNode,
      before: 'Link'
    }
  ]
};
