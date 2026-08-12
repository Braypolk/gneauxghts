import MarkdownIt from 'markdown-it';
import { parseWikilink } from '$lib/features/notepad/wikilinks/parse';

export type ChatMarkdownBlock =
  | {
      key: string;
      type: 'html';
      html: string;
    }
  | {
      key: string;
      type: 'code';
      code: string;
      language: string;
    };

function isSafeWebHref(href: string) {
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function installHighlightRule(markdown: any) {
  markdown.inline.ruler.before(
    'emphasis',
    'chat_highlight',
    (state: any, silent: boolean) => {
      const start = state.pos;
      if (state.src.slice(start, start + 2) !== '==') return false;

      const end = state.src.indexOf('==', start + 2);
      if (end < 0 || end === start + 2 || state.src.slice(start + 2, end).includes('\n')) {
        return false;
      }

      if (!silent) {
        const token = state.push('chat_highlight', 'mark', 0);
        token.content = state.src.slice(start + 2, end);
      }
      state.pos = end + 2;
      return true;
    }
  );
}

function installWikilinkRule(markdown: any) {
  markdown.inline.ruler.before(
    'link',
    'chat_wikilink',
    (state: any, silent: boolean) => {
      const start = state.pos;
      if (
        state.src.slice(start, start + 2) !== '[[' ||
        (start > 0 && state.src[start - 1] === '!')
      ) {
        return false;
      }

      const end = state.src.indexOf(']]', start + 2);
      if (end < 0 || state.src.slice(start + 2, end).includes('\n')) return false;

      const rawTarget = state.src.slice(start + 2, end);
      const parsed = parseWikilink(rawTarget);
      if (!parsed.target) return false;

      if (!silent) {
        const token = state.push('chat_wikilink', '', 0);
        token.meta = {
          rawTarget,
          label: parsed.alias ?? parsed.target
        };
      }
      state.pos = end + 2;
      return true;
    }
  );
}

function installTaskListRule(markdown: any) {
  markdown.core.ruler.after('inline', 'chat_task_lists', (state: any) => {
    const openListItems: number[] = [];

    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (token.type === 'list_item_open') {
        openListItems.push(index);
        continue;
      }
      if (token.type === 'list_item_close') {
        openListItems.pop();
        continue;
      }
      if (token.type !== 'inline' || openListItems.length === 0) continue;

      const firstChild = token.children?.[0];
      if (!firstChild || firstChild.type !== 'text') continue;
      const match = firstChild.content.match(/^\[([ xX])\]\s+/);
      if (!match) continue;

      firstChild.content = firstChild.content.slice(match[0].length);
      const checkbox = new firstChild.constructor('chat_task_checkbox', 'input', 0);
      checkbox.meta = { checked: match[1].toLowerCase() === 'x' };
      token.children.unshift(checkbox);
      const listItemIndex = openListItems.at(-1);
      if (listItemIndex === undefined) continue;
      state.tokens[listItemIndex].attrJoin(
        'class',
        'gn-markdown-task-item'
      );
    }
  });
}

function createChatMarkdown() {
  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

  markdown.validateLink = isSafeWebHref;
  installHighlightRule(markdown);
  installWikilinkRule(markdown);
  installTaskListRule(markdown);

  markdown.renderer.rules.chat_highlight = (tokens: any[], index: number) =>
    `<mark>${markdown.utils.escapeHtml(tokens[index].content)}</mark>`;
  markdown.renderer.rules.chat_wikilink = (tokens: any[], index: number) => {
    const { rawTarget, label } = tokens[index].meta;
    return `<button type="button" class="gn-markdown-wikilink" data-wikilink-target="${markdown.utils.escapeHtml(rawTarget)}">${markdown.utils.escapeHtml(label)}</button>`;
  };
  markdown.renderer.rules.chat_task_checkbox = (tokens: any[], index: number) => {
    const checked = Boolean(tokens[index].meta?.checked);
    return `<input class="gn-markdown-task-checkbox" type="checkbox" disabled aria-label="${checked ? 'Completed task' : 'Incomplete task'}"${checked ? ' checked' : ''}>`;
  };
  markdown.renderer.rules.image = (tokens: any[], index: number) => {
    const label = tokens[index].content?.trim() || 'Image';
    return `<span class="gn-markdown-image-reference">${markdown.utils.escapeHtml(label)}</span>`;
  };

  const defaultLinkOpen = markdown.renderer.rules.link_open;
  markdown.renderer.rules.link_open = (
    tokens: any[],
    index: number,
    options: any,
    env: any,
    self: any
  ) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };

  return markdown;
}

const markdown = createChatMarkdown();

export function renderChatMarkdown(content: string) {
  return markdown.render(content);
}

export function parseChatMarkdownBlocks(content: string): ChatMarkdownBlock[] {
  const tokens = markdown.parse(content, {});
  const blocks: ChatMarkdownBlock[] = [];
  let pendingHtml: any[] = [];
  let depth = 0;
  let htmlOrdinal = 0;
  let codeOrdinal = 0;

  const flushHtml = () => {
    if (pendingHtml.length === 0) return;
    blocks.push({
      key: `html-${htmlOrdinal}`,
      type: 'html',
      html: markdown.renderer.render(pendingHtml, markdown.options, {})
    });
    htmlOrdinal += 1;
    pendingHtml = [];
  };

  for (const token of tokens) {
    if (token.type === 'fence' && depth === 0) {
      flushHtml();
      blocks.push({
        key: `code-${codeOrdinal}`,
        type: 'code',
        code: token.content,
        language: normalizeCodeLanguage(token.info)
      });
      codeOrdinal += 1;
      continue;
    }

    pendingHtml.push(token);
    depth += token.nesting;
  }
  flushHtml();
  return blocks;
}

export function normalizeCodeLanguage(info: string | null | undefined) {
  const candidate = info?.trim().split(/\s+/, 1)[0] ?? '';
  return candidate.replace(/^\{\.?/, '').replace(/\}$/, '').trim();
}
