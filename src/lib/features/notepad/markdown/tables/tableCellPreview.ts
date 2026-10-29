import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import MarkdownIt from 'markdown-it';
import { parseWikilink } from '../../wikilinks/parse';
import type { TableCell } from './tableModel';

interface CellSyntax {
  to: number;
  kind: 'comment' | 'wikilink';
  content: string;
}
interface CellLink { from: number; to: number; href: string }

const inline = new MarkdownIt({ html: false, linkify: false, breaks: false });
// Images stay passive. Links use the editor's existing navigation handlers,
// rather than browser anchors inside the cell's edit button.
inline.renderer.rules.image = (tokens, index) => inline.utils.escapeHtml(tokens[index].content);
inline.renderer.rules.link_open = (tokens, index, _options, env) => {
  const href = String(tokens[index].attrGet('href') ?? '');
  const links = env?.links as CellLink[];
  const match = links.findIndex(link => link.href === href);
  if (match < 0) return '<span>';
  const link = links.splice(match, 1)[0];
  const escaped = inline.utils.escapeHtml(href);
  return `<span class="cm-gn-link-styled" data-link-from="${link.from}" data-link-to="${link.to}" title="${escaped}"><span class="cm-gn-link-tooltip">${escaped}</span>`;
};
inline.renderer.rules.link_close = () => '</span>';

inline.inline.ruler.before('emphasis', 'cell_syntax', (state, silent) => {
  if (silent) return false;
  const syntax = (state.env.cellSyntax as Map<number, CellSyntax>).get(state.pos);
  if (syntax) {
    const token = state.push('cell_syntax_open', 'span', 1);
    token.attrSet('class', syntax.kind === 'comment' ? 'cm-gn-comment' : 'gn-wikilink');
    let label = syntax.content;
    if (syntax.kind === 'wikilink') {
      const parsed = parseWikilink(syntax.content);
      token.attrSet('data-wikilink-target', syntax.content);
      token.attrSet('data-wikilink-from', String(Number(state.env.cellFrom) + state.pos));
      token.attrSet('data-wikilink-to', String(Number(state.env.cellFrom) + syntax.to));
      token.attrSet('title', 'Cmd/Ctrl-click to open note');
      label = `[[${parsed.alias ?? parsed.target}]]`;
    }
    state.push('text', '', 0).content = label;
    state.push('cell_syntax_close', 'span', -1);
    state.pos = syntax.to;
    return true;
  }
  if (state.src.slice(state.pos, state.pos + 2) !== '==') return false;
  const nesting = (state.env.highlightMarkers as Map<number, 1 | -1>).get(state.pos);
  if (!nesting) return false;
  const token = state.push(nesting === 1 ? 'highlight_open' : 'highlight_close', 'span', nesting);
  if (nesting === 1) token.attrSet('class', 'cm-gn-highlight');
  state.pos += 2;
  return true;
});

export function renderTableCellPreview(state: EditorState, cell: TableCell): string {
  // The editor's parsed nodes keep escapes, code spans, comments and unmatched
  // delimiters consistent with ordinary prose, without another syntax grammar.
  const highlightMarkers = new Map<number, 1 | -1>();
  const cellSyntax = new Map<number, CellSyntax>();
  const links: CellLink[] = [];
  syntaxTree(state).iterate({ from: cell.from, to: cell.to, enter(node) {
    if (node.from < cell.from || node.to > cell.to) return;
    if (node.name === 'HighlightMark') {
      highlightMarkers.set(node.from - cell.from, node.from === node.node.parent?.from ? 1 : -1);
    } else if (node.name === 'InlineComment' || node.name === 'Wikilink') {
      const kind = node.name === 'InlineComment' ? 'comment' : 'wikilink';
      const raw = state.sliceDoc(node.from + 2, node.to - 2);
      // Pipes in a table alias must be escaped in Markdown source.
      const content = kind === 'wikilink' ? raw.replace(/\\\|/g, '|') : raw;
      if (kind === 'comment' || parseWikilink(content).target) {
        cellSyntax.set(node.from - cell.from, { to: node.to - cell.from, kind, content });
      }
      return false;
    } else if (node.name === 'Link' || node.name === 'Autolink') {
      const url = node.node.getChild('URL');
      if (url) {
        const raw = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '');
        links.push({ from: node.from, to: node.to, href: inline.normalizeLink(inline.utils.unescapeAll(raw)) });
      }
    }
  } });
  return inline.renderInline(cell.value, { highlightMarkers, cellSyntax, links, cellFrom: cell.from });
}
