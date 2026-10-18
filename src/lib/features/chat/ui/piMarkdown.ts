import MarkdownIt from 'markdown-it';
import { admittedSourceIds, sourceIdFromHref } from '../pi/citations';

/** App source destinations become interactive only in admitted terminal answers. */
export function renderPiMarkdown(source: string, admitted = false): string {
  const allowed = admitted ? admittedSourceIds(source) : new Set<string>();
  const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
  markdown.validateLink = (href: string) => /^https?:\/\//i.test(href) || allowed.has(sourceIdFromHref(href) ?? '');
  const linkOpen = markdown.renderer.rules.link_open;
  markdown.renderer.rules.link_open = (tokens: any[], index: number, options: any, env: any, self: any) => {
    const token = tokens[index], href = token.attrGet('href') ?? '';
    const id = sourceIdFromHref(href);
    if (id && allowed.has(id)) {
      token.attrSet('data-pi-source', id);
      token.attrSet('href', '#');
      if (tokens[index + 1]?.type === 'text' && tokens[index + 1].content.startsWith('Note: '))
        tokens[index + 1].content = tokens[index + 1].content.slice(6);
    } else { token.attrSet('target', '_blank'); token.attrSet('rel', 'noopener noreferrer'); }
    return linkOpen ? linkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
  };
  return markdown.render(source);
}
