import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { Range } from '@codemirror/state';
import type { MarkdownNodeDecorator } from './types';

// Links: when the selection is outside the link, the raw `[text](url)` markdown
// is replaced by a styled, clickable span carrying the URL in a hidden tooltip
// element. The external-link click handler in editor.ts reads that tooltip text
// (scoped to `.cm-gn-link-styled`) to resolve the URL — keep the class names and
// tooltip element in sync with `findRenderedMarkdownLinkUrl`. When the selection
// overlaps the link, the raw markdown is revealed with marker styling so it can
// be edited.

const linkText = Decoration.mark({ class: 'cm-gn-link-text' });
const linkMarker = Decoration.mark({ class: 'cm-gn-link-marker' });
const linkUrl = Decoration.mark({ class: 'cm-gn-link-url' });

interface ParsedLink {
  text: string;
  url: string;
  title?: string;
}

function parseLinkMarkdown(content: string): ParsedLink | null {
  const match = content.match(/^\[([^\]]*)\]\(([^"\s)]+)(?:\s+"([^"]*)")?\s*\)$/);
  if (!match) {
    return null;
  }
  const result: ParsedLink = { text: match[1] ?? '', url: match[2] };
  if (match[3] !== undefined) {
    result.title = match[3];
  }
  return result;
}

class LinkTextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly url: string,
    readonly from: number,
    readonly to: number,
    readonly title?: string
  ) {
    super();
  }

  override eq(other: LinkTextWidget): boolean {
    return (
      other.text === this.text &&
      other.url === this.url &&
      other.from === this.from &&
      other.to === this.to &&
      other.title === this.title
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-gn-link-styled';
    span.textContent = this.text;
    span.style.cursor = 'pointer';
    if (this.title) {
      span.title = this.title;
    }

    const tooltip = document.createElement('span');
    tooltip.className = 'cm-gn-link-tooltip';
    tooltip.textContent = this.url;
    span.appendChild(tooltip);

    span.addEventListener('mouseenter', () => tooltip.classList.add('cm-gn-link-tooltip-visible'));
    span.addEventListener('mouseleave', () => tooltip.classList.remove('cm-gn-link-tooltip-visible'));

    span.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey) {
        // Let the capture-phase external-link handler in editor.ts open it.
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.from, head: this.to }, scrollIntoView: true });
      view.focus();
    });

    return span;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== 'click' && event.type !== 'mouseenter' && event.type !== 'mouseleave';
  }
}

function decorateRawLink(node: SyntaxNode, view: EditorView, decorations: Range<Decoration>[]): void {
  const content = view.state.sliceDoc(node.from, node.to);
  decorations.push(linkMarker.range(node.from, node.from + 1));

  const bracketParen = content.indexOf('](');
  if (bracketParen === -1) {
    return;
  }
  if (bracketParen > 1) {
    decorations.push(linkText.range(node.from + 1, node.from + bracketParen));
  }
  decorations.push(linkMarker.range(node.from + bracketParen, node.from + bracketParen + 2));

  const urlChild = node.getChild('URL');
  if (urlChild) {
    decorations.push(linkUrl.range(urlChild.from, urlChild.to));
  }
  decorations.push(linkMarker.range(node.to - 1, node.to));
}

export const decorateLink: MarkdownNodeDecorator = (ctx, node) => {
  if (node.name !== 'Link') {
    return;
  }

  const { view, decorations } = ctx;
  const parsed = parseLinkMarkdown(view.state.sliceDoc(node.from, node.to));
  if (!parsed) {
    return;
  }

  if (ctx.selectionOverlaps(node.from, node.to)) {
    decorateRawLink(node.node, view, decorations);
    return;
  }

  decorations.push(
    Decoration.replace({
      widget: new LinkTextWidget(parsed.text, parsed.url, node.from, node.to, parsed.title)
    }).range(node.from, node.to)
  );
};
