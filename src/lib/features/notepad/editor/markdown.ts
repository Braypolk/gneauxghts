import MarkdownIt from 'markdown-it';
import {
  MarkdownParser,
  MarkdownSerializer,
  type ParseSpec
} from 'prosemirror-markdown';
import { Fragment, type Node as ProseMirrorNode } from 'prosemirror-model';
import { notepadSchema } from '$lib/features/notepad/editor/schema';

const TASK_LIST_PATTERN = /^\[( |x|X)\]\s+/;
const HTML_BREAK_PATTERN = /<br\s*\/?>/i;
const HTML_BREAK_GLOBAL_PATTERN = /<br\s*\/?>/gi;

function stripPrefixFromInlineChildren(children: Array<any> | null, prefixLength: number) {
  if (!children || prefixLength <= 0) {
    return;
  }

  let remaining = prefixLength;
  for (const child of children) {
    if (remaining <= 0) {
      break;
    }

    if (child.type !== 'text' || child.content.length === 0) {
      continue;
    }

    if (child.content.length <= remaining) {
      remaining -= child.content.length;
      child.content = '';
      continue;
    }

    child.content = child.content.slice(remaining);
    remaining = 0;
  }
}

function taskListPlugin(markdown: any) {
  markdown.core.ruler.after('inline', 'gneauxghts-task-lists', (state: any) => {
    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (token.type !== 'list_item_open') {
        continue;
      }

      const paragraphOpen = state.tokens[index + 1];
      const inline = state.tokens[index + 2];
      if (paragraphOpen?.type !== 'paragraph_open' || inline?.type !== 'inline') {
        continue;
      }

      const match = inline.content.match(TASK_LIST_PATTERN);
      if (!match) {
        continue;
      }

      token.meta = {
        ...(token.meta ?? {}),
        checked: match[1]?.toLowerCase() === 'x'
      };
      inline.content = inline.content.slice(match[0].length);
      stripPrefixFromInlineChildren(inline.children ?? null, match[0].length);
    }
  });
}

function createInlineToken(state: any, type: string, content = '') {
  const token = new state.Token(type, '', 0);
  token.content = content;
  return token;
}

function htmlBreakPlugin(markdown: any) {
  markdown.core.ruler.after('inline', 'gneauxghts-html-breaks', (state: any) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !Array.isArray(token.children) || token.children.length === 0) {
        continue;
      }

      const rewrittenChildren: Array<any> = [];
      let changed = false;

      for (const child of token.children) {
        if (child.type !== 'text' || typeof child.content !== 'string') {
          rewrittenChildren.push(child);
          continue;
        }

        if (!HTML_BREAK_PATTERN.test(child.content)) {
          rewrittenChildren.push(child);
          continue;
        }

        changed = true;
        const segments = child.content.split(HTML_BREAK_GLOBAL_PATTERN);
        const matches = child.content.match(HTML_BREAK_GLOBAL_PATTERN) ?? [];

        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
          const segment = segments[segmentIndex];
          if (segment.length > 0) {
            rewrittenChildren.push(createInlineToken(state, 'text', segment));
          }

          if (segmentIndex < matches.length) {
            rewrittenChildren.push(createInlineToken(state, 'hardbreak'));
          }
        }
      }

      if (changed) {
        token.children = rewrittenChildren;
      }
    }
  });
}

function buildMarkdownTokenizer() {
  return new MarkdownIt('default', {
    html: false,
    linkify: true
  })
    .use(taskListPlugin)
    .use(htmlBreakPlugin);
}

function getTightAttr(token: any) {
  return token.hidden ?? false;
}

const parserTokens: Record<string, ParseSpec> = {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: {
    block: 'list_item',
    getAttrs(token) {
      return {
        checked: typeof token.meta?.checked === 'boolean' ? token.meta.checked : null
      };
    }
  },
  bullet_list: {
    block: 'bullet_list',
    getAttrs(token) {
      return {
        bullet: token.markup || '-',
        tight: getTightAttr(token)
      };
    }
  },
  ordered_list: {
    block: 'ordered_list',
    getAttrs(token) {
      return {
        order: Number(token.attrGet('start')) || 1,
        tight: getTightAttr(token)
      };
    }
  },
  heading: {
    block: 'heading',
    getAttrs(token) {
      return {
        level: Number(token.tag.slice(1)) || 1
      };
    }
  },
  code_block: {
    block: 'code_block',
    noCloseToken: true,
    getAttrs() {
      return {
        params: ''
      };
    }
  },
  fence: {
    block: 'code_block',
    noCloseToken: true,
    getAttrs(token) {
      return {
        params: token.info ?? ''
      };
    }
  },
  hr: {
    node: 'horizontal_rule',
    getAttrs(token) {
      return {
        markup: token.markup || '---'
      };
    }
  },
  image: {
    node: 'image',
    getAttrs(token) {
      return {
        src: token.attrGet('src') || '',
        title: token.attrGet('title'),
        alt: token.content || null
      };
    }
  },
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strike' },
  link: {
    mark: 'link',
    getAttrs(token) {
      return {
        href: token.attrGet('href') || '',
        title: token.attrGet('title')
      };
    }
  },
  code_inline: { mark: 'code', noCloseToken: true },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: {
    block: 'table_header',
    getAttrs(token) {
      const style = token.attrGet('style') ?? '';
      const align = style.match(/text-align:\s*(left|center|right)/i)?.[1]?.toLowerCase() ?? null;
      return { align };
    }
  },
  td: {
    block: 'table_cell',
    getAttrs(token) {
      const style = token.attrGet('style') ?? '';
      const align = style.match(/text-align:\s*(left|center|right)/i)?.[1]?.toLowerCase() ?? null;
      return { align };
    }
  }
};

export const markdownParser = new MarkdownParser(
  notepadSchema,
  buildMarkdownTokenizer(),
  parserTokens
);

function serializeInlineNodeContent(node: ProseMirrorNode, serializer: MarkdownSerializer) {
  return serializer.serialize(node).trim();
}

function serializeTableCell(node: ProseMirrorNode, serializer: MarkdownSerializer) {
  let content = '';

  if (node.childCount === 0) {
    content = '';
  } else if (node.childCount === 1 && node.firstChild) {
    const child = node.firstChild;
    if (child.type.name === 'paragraph') {
      content = serializeInlineNodeContent(child, serializer);
    } else {
      content = serializer.serialize(child).trim();
    }
  } else {
    content = serializer.serialize(node).trim();
  }

  return content
    .replace(/\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function isTaskListNode(node: ProseMirrorNode) {
  return (
    node.type.name === 'bullet_list' &&
    node.childCount > 0 &&
    Array.from({ length: node.childCount }, (_, index) => node.child(index)).every(
      (child) => child.type.name === 'list_item' && child.attrs.checked != null
    )
  );
}

function renderTaskListItem(state: any, node: ProseMirrorNode) {
  const marker = node.attrs.checked ? '[x]' : '[ ]';
  const firstChild = node.firstChild;
  state.write(`${marker} `);

  if (!firstChild) {
    return;
  }

  if (firstChild.type.name === 'paragraph') {
    state.renderInline(firstChild, false);
    state.closeBlock(firstChild);
  } else {
    state.render(firstChild, node, 0);
  }

  for (let childIndex = 1; childIndex < node.childCount; childIndex += 1) {
    state.ensureNewLine();
    state.render(node.child(childIndex), node, childIndex);
  }
}

const nodeSerializers: MarkdownSerializer['nodes'] = {
  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node));
  },
  code_block(state, node) {
    const params = typeof node.attrs.params === 'string' ? node.attrs.params.trim() : '';
    const fences = node.textContent.match(/`{3,}/g);
    const fence = fences ? `${fences.sort((left, right) => right.length - left.length)[0]}\`` : '```';
    state.write(`${fence}${params ? params : ''}\n`);
    state.text(node.textContent, false);
    state.write('\n');
    state.write(fence);
    state.closeBlock(node);
  },
  heading(state, node) {
    state.write(`${state.repeat('#', node.attrs.level)} `);
    state.renderInline(node, false);
    state.closeBlock(node);
  },
  horizontal_rule(state, node) {
    state.write(node.attrs.markup || '---');
    state.closeBlock(node);
  },
  bullet_list(state, node) {
    const bullet = typeof node.attrs.bullet === 'string' && node.attrs.bullet.length > 0
      ? node.attrs.bullet
      : '-';

    if (isTaskListNode(node)) {
      const serializerState = state as typeof state & {
        closed?: ProseMirrorNode | null;
        flushClose: (size?: number) => void;
        inTightList: boolean;
        options: { tightLists: boolean };
        wrapBlock: (
          delim: string,
          firstDelim: string | null,
          node: ProseMirrorNode,
          render: () => void
        ) => void;
      };

      if (serializerState.closed && serializerState.closed.type === node.type) {
        serializerState.flushClose(3);
      } else if (serializerState.inTightList) {
        serializerState.flushClose(1);
      }

      const isTight =
        typeof node.attrs.tight !== 'undefined'
          ? node.attrs.tight
          : serializerState.options.tightLists;
      const previousTight = serializerState.inTightList;
      serializerState.inTightList = isTight;

      node.forEach((child, _, index) => {
        if (index && isTight) {
          serializerState.flushClose(1);
        }

        serializerState.wrapBlock('  ', `${bullet} `, node, () => {
          renderTaskListItem(serializerState, child);
        });
      });

      serializerState.inTightList = previousTight;
      return;
    }

    state.renderList(node, '  ', () => `${bullet} `);
  },
  ordered_list(state, node) {
    const start = Number(node.attrs.order) || 1;
    const maxWidth = String(start + node.childCount - 1).length;
    const delimiter = state.repeat(' ', maxWidth + 2);
    state.renderList(node, delimiter, (index) => {
      const numberString = String(start + index);
      return `${state.repeat(' ', maxWidth - numberString.length)}${numberString}. `;
    });
  },
  list_item(state, node, parent, index) {
    if (node.attrs.checked == null) {
      state.renderContent(node);
      return;
    }

    if (isTaskListNode(parent)) {
      state.renderContent(node);
      return;
    }

    const marker = node.attrs.checked ? '[x]' : '[ ]';
    const firstParagraph = node.firstChild;
    if (!firstParagraph) {
      state.write(marker);
      state.closeBlock(node);
      return;
    }

    const contentDelim = state.repeat(' ', marker.length + 1);
    state.wrapBlock(contentDelim, `${marker} `, node, () => {
      if (firstParagraph.type.name === 'paragraph') {
        state.renderInline(firstParagraph, false);
      } else {
        state.render(firstParagraph, node, 0);
      }

      for (let childIndex = 1; childIndex < node.childCount; childIndex += 1) {
        state.ensureNewLine();
        state.render(node.child(childIndex), node, childIndex);
      }
    });
  },
  paragraph(state, node) {
    if (node.childCount === 0) {
      state.write('<br/>');
      state.closeBlock(node);
      return;
    }

    state.renderInline(node);
    state.closeBlock(node);
  },
  image(state, node) {
    const alt = state.esc(node.attrs.alt || '');
    const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : '';
    state.write(`![${alt}](${String(node.attrs.src).replace(/[\(\)]/g, '\\$&')}${title})`);
  },
  hard_break(state, node, parent, index) {
    state.write('<br/>');
  },
  text(state, node) {
    const extendedState = state as typeof state & { inAutolink?: boolean };
    state.text(node.text ?? '', !extendedState.inAutolink);
  },
  table(state, node) {
    const rows = Array.from({ length: node.childCount }, (_, index) => node.child(index));
    const headerRow = rows[0];
    if (!headerRow) {
      return;
    }

    const columnCount = headerRow.childCount;
    const alignments = Array.from({ length: columnCount }, (_, columnIndex) =>
      headerRow.child(columnIndex)?.attrs.align ?? null
    );

    const renderRow = (row: ProseMirrorNode) => {
      const cells = Array.from({ length: columnCount }, (_, columnIndex) => {
        const cell = row.child(columnIndex);
        return serializeTableCell(cell, markdownSerializer);
      });
      state.write(`| ${cells.join(' | ')} |`);
      state.ensureNewLine();
    };

    renderRow(headerRow);
    const alignmentRow = alignments.map((align) => {
      if (align === 'left') {
        return ':-';
      }
      if (align === 'center') {
        return ':-:';
      }
      if (align === 'right') {
        return '-:';
      }
      return '-';
    });
    state.write(`| ${alignmentRow.join(' | ')} |`);
    state.ensureNewLine();

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      renderRow(rows[rowIndex]);
    }

    state.closeBlock(node);
  },
  table_row() {},
  table_cell() {},
  table_header() {}
};

const markSerializers: MarkdownSerializer['marks'] = {
  em: {
    open: '*',
    close: '*',
    mixable: true,
    expelEnclosingWhitespace: true
  },
  strong: {
    open: '**',
    close: '**',
    mixable: true,
    expelEnclosingWhitespace: true
  },
  strike: {
    open: '~~',
    close: '~~',
    mixable: true,
    expelEnclosingWhitespace: true
  },
  link: {
    open(state, mark, parent, index) {
      const extendedState = state as typeof state & { inAutolink?: boolean };
      const content = parent.child(index);
      extendedState.inAutolink =
        !mark.attrs.title &&
        /^\w+:/.test(mark.attrs.href) &&
        content.isText &&
        content.text === mark.attrs.href &&
        content.marks[content.marks.length - 1] === mark &&
        (index === parent.childCount - 1 || !mark.isInSet(parent.child(index + 1).marks));
      return extendedState.inAutolink ? '<' : '[';
    },
    close(state, mark) {
      const extendedState = state as typeof state & { inAutolink?: boolean };
      const inAutolink = extendedState.inAutolink;
      extendedState.inAutolink = undefined;
      if (inAutolink) {
        return '>';
      }

      const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : '';
      return `](${String(mark.attrs.href).replace(/[\(\)"]/g, '\\$&')}${title})`;
    },
    mixable: true
  },
  code: {
    open(_state, _mark, parent, index) {
      const node = parent.child(index);
      const ticks = node.text?.match(/`+/g) ?? [];
      const maxLength = ticks.reduce((max, tick) => Math.max(max, tick.length), 0);
      return maxLength > 0 ? ` ${'`'.repeat(maxLength + 1)}` : '`';
    },
    close(_state, _mark, parent, index) {
      const node = parent.child(index - 1);
      const ticks = node.text?.match(/`+/g) ?? [];
      const maxLength = ticks.reduce((max, tick) => Math.max(max, tick.length), 0);
      return maxLength > 0 ? `${'`'.repeat(maxLength + 1)} ` : '`';
    },
    escape: false
  }
};

export const markdownSerializer = new MarkdownSerializer(nodeSerializers, markSerializers);

function normalizeParsedBreakParagraphs(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isText || node.isLeaf) {
    return node;
  }

  if (
    node.type.name === 'paragraph' &&
    node.childCount === 1 &&
    node.firstChild?.type.name === 'hard_break'
  ) {
    return notepadSchema.nodes.paragraph.create(node.attrs);
  }

  const children: ProseMirrorNode[] = [];
  let changed = false;

  node.forEach((child) => {
    const normalizedChild = normalizeParsedBreakParagraphs(child);
    if (normalizedChild !== child) {
      changed = true;
    }
    children.push(normalizedChild);
  });

  if (!changed) {
    return node;
  }

  return node.copy(Fragment.fromArray(children));
}

export function parseMarkdown(markdown: string) {
  return normalizeParsedBreakParagraphs(markdownParser.parse(markdown));
}

export function serializeMarkdown(node: ProseMirrorNode) {
  return markdownSerializer.serialize(node);
}
