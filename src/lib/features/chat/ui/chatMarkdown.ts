import MarkdownIt from 'markdown-it';
import { parseWikilink } from '$lib/features/notepad/wikilinks/parse';
import type { ChatCitation } from '../types';

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

function normalizedWebHref(href: string) {
  if (!isSafeWebHref(href)) return null;
  return new URL(href).href;
}

function normalizedNoteReference(value: string) {
  let decoded = value.trim().replace(/^<|>$/g, '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // A malformed escape cannot match a persisted note path.
  }
  return decoded
    .split('#', 1)[0]
    .replace(/^file:\/\//, '')
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
    .toLowerCase();
}

function noteReferenceNames(citation: Extract<ChatCitation, { kind: 'note' }>) {
  const path = normalizedNoteReference(citation.notePath);
  const basename = path.split('/').at(-1) ?? path;
  const stem = basename.replace(/\.md$/i, '');
  return new Set([
    path,
    basename,
    stem,
    normalizedNoteReference(citation.label)
  ].filter(Boolean));
}

function matchingNoteCitation(
  citations: ChatCitation[],
  label: string,
  destination?: string
) {
  const labelReference = normalizedNoteReference(label);
  const destinationReference = destination
    ? normalizedNoteReference(destination)
    : '';
  return citations.find((citation): citation is Extract<ChatCitation, { kind: 'note' }> => {
    if (citation.kind !== 'note') return false;
    const names = noteReferenceNames(citation);
    const destinationMatches = destinationReference && [...names].some((name) =>
      destinationReference === name || destinationReference.endsWith(`/${name}`)
    );
    return Boolean(destinationMatches || names.has(labelReference));
  }) ?? null;
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
          target: parsed.target,
          label: parsed.alias ?? parsed.target
        };
      }
      state.pos = end + 2;
      return true;
    }
  );
}

function installNoteCitationLinkRule(markdown: any) {
  markdown.inline.ruler.before(
    'link',
    'chat_note_citation_link',
    (state: any, silent: boolean) => {
      const start = state.pos;
      if (state.src[start] !== '[' || state.src[start + 1] === '[') return false;
      const labelEnd = state.src.indexOf(']', start + 1);
      if (labelEnd < 0 || state.src.slice(start + 1, labelEnd).includes('\n')) return false;

      const label = state.src.slice(start + 1, labelEnd).trim();
      if (!label) return false;
      let destinationStart = labelEnd + 1;
      while (state.src[destinationStart] === ' ' || state.src[destinationStart] === '\t') {
        destinationStart += 1;
      }
      const hasDestination = state.src[destinationStart] === '(';
      const destinationEnd = hasDestination
        ? state.src.indexOf(')', destinationStart + 1)
        : -1;
      if (hasDestination && destinationEnd < 0) return false;
      const destination = hasDestination
        ? state.src.slice(destinationStart + 1, destinationEnd).trim()
        : undefined;
      const citations = (state.env?.citations ?? []) as ChatCitation[];
      const citation = matchingNoteCitation(citations, label, destination);
      if (!citation) return false;

      if (!silent) {
        const token = state.push('chat_note_citation_link', 'button', 0);
        token.meta = { citation, label };
      }
      state.pos = hasDestination ? destinationEnd + 1 : labelEnd + 1;
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

function installInlineCitationRule(markdown: any) {
  markdown.core.ruler.after('inline', 'chat_inline_citations', (state: any) => {
    const citations = (state.env?.citations ?? []) as ChatCitation[];
    const citationsByUrl = new Map(
      citations.flatMap((citation, index) => {
        if (citation.kind !== 'web') return [];
        const url = normalizedWebHref(citation.url);
        return url ? [[url, { citation, index: index + 1 }] as const] : [];
      })
    );
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue;
      const decorated: any[] = [];
      let activeCitation: { citation: ChatCitation; index: number } | null = null;

      for (const child of token.children) {
        if (child.type === 'link_open') {
          const href = child.attrGet('href');
          activeCitation = href
            ? citationsByUrl.get(normalizedWebHref(href) ?? '') ?? null
            : null;
        }
        decorated.push(child);
        if (child.type === 'chat_wikilink') {
          const citation = matchingNoteCitation(citations, child.meta?.label ?? '', child.meta?.target);
          const citationIndex = citation
            ? citations.findIndex((candidate) => candidate.id === citation.id)
            : -1;
          if (citation && citationIndex >= 0) {
            const citationToken = new child.constructor('chat_inline_citation', 'sup', 0);
            citationToken.meta = { citation, index: citationIndex + 1 };
            decorated.push(citationToken);
          }
        }
        if (child.type === 'chat_note_citation_link') {
          const citationIndex = citations.findIndex(
            (candidate) => candidate.id === child.meta?.citation?.id
          );
          if (citationIndex >= 0) {
            const citationToken = new child.constructor('chat_inline_citation', 'sup', 0);
            citationToken.meta = { citation: child.meta.citation, index: citationIndex + 1 };
            decorated.push(citationToken);
          }
        }
        if (child.type === 'link_close' && activeCitation) {
          const citationToken = new child.constructor('chat_inline_citation', 'sup', 0);
          citationToken.meta = activeCitation;
          decorated.push(citationToken);
          activeCitation = null;
        }
      }
      token.children = decorated;
    }
  });
}

function createChatMarkdown() {
  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

  markdown.validateLink = isSafeWebHref;
  installHighlightRule(markdown);
  installWikilinkRule(markdown);
  installNoteCitationLinkRule(markdown);
  installTaskListRule(markdown);
  installInlineCitationRule(markdown);

  markdown.renderer.rules.chat_highlight = (tokens: any[], index: number) =>
    `<mark>${markdown.utils.escapeHtml(tokens[index].content)}</mark>`;
  markdown.renderer.rules.chat_wikilink = (tokens: any[], index: number) => {
    const { rawTarget, label } = tokens[index].meta;
    return `<button type="button" class="gn-markdown-wikilink" data-wikilink-target="${markdown.utils.escapeHtml(rawTarget)}">${markdown.utils.escapeHtml(label)}</button>`;
  };
  markdown.renderer.rules.chat_note_citation_link = (tokens: any[], index: number) => {
    const { citation, label } = tokens[index].meta as {
      citation: Extract<ChatCitation, { kind: 'note' }>;
      label: string;
    };
    return `<button type="button" class="gn-markdown-wikilink" data-chat-note-citation-id="${markdown.utils.escapeHtml(citation.id)}">${markdown.utils.escapeHtml(label)}</button>`;
  };
  markdown.renderer.rules.chat_task_checkbox = (tokens: any[], index: number) => {
    const checked = Boolean(tokens[index].meta?.checked);
    return `<input class="gn-markdown-task-checkbox" type="checkbox" disabled aria-label="${checked ? 'Completed task' : 'Incomplete task'}"${checked ? ' checked' : ''}>`;
  };
  markdown.renderer.rules.chat_inline_citation = (tokens: any[], index: number) => {
    const { citation, index: citationIndex } = tokens[index].meta as {
      citation: ChatCitation;
      index: number;
    };
    const label = citation.label || (citation.kind === 'web' ? citation.url : citation.notePath);
    const common = `class="gn-markdown-inline-citation" data-chat-citation-id="${markdown.utils.escapeHtml(citation.id)}"`;
    if (citation.kind === 'note') {
      return `<sup ${common}><button type="button" data-chat-note-citation-id="${markdown.utils.escapeHtml(citation.id)}" aria-label="Source ${citationIndex}: ${markdown.utils.escapeHtml(label)}" title="${markdown.utils.escapeHtml(label)}">[${citationIndex}]</button></sup>`;
    }
    const href = normalizedWebHref(citation.url) ?? '#';
    return `<sup ${common}><a href="${markdown.utils.escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="Source ${citationIndex}: ${markdown.utils.escapeHtml(label)}" title="${markdown.utils.escapeHtml(label)}">[${citationIndex}]</a></sup>`;
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

export function renderChatMarkdown(content: string, citations: ChatCitation[] = []) {
  return markdown.render(content, { citations });
}

export function parseChatMarkdownBlocks(
  content: string,
  citations: ChatCitation[] = []
): ChatMarkdownBlock[] {
  const environment = { citations };
  const tokens = markdown.parse(content, environment);
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
      html: markdown.renderer.render(pendingHtml, markdown.options, environment)
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
