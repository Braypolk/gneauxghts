interface MarkdownElementOptions {
  href?: string | null;
  wikilinkTarget?: string | null;
  checked?: boolean;
  orderedIndex?: number | null;
  codeLanguage?: string | null;
  classes?: readonly string[];
}

function inlineCodeFence(content: string) {
  const longestRun = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length)
  );
  return '`'.repeat(longestRun + 1);
}

function prefixLines(content: string, prefix: string) {
  return content
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

/** Pure wrapper used by the DOM serializer and covered without a browser DOM. */
export function wrapChatMarkdownElement(
  tagName: string,
  content: string,
  options: MarkdownElementOptions = {}
) {
  const tag = tagName.toLowerCase();
  const classes = new Set(options.classes ?? []);

  if (options.codeLanguage !== undefined) {
    const language = options.codeLanguage?.trim() ?? '';
    return `\`\`\`${language}\n${content.replace(/^\n+|\n+$/g, '')}\n\`\`\`\n\n`;
  }
  if (options.wikilinkTarget) return `[[${options.wikilinkTarget}]]`;
  if (/^h[1-6]$/.test(tag)) {
    return `${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
  }
  if (tag === 'strong' || tag === 'b') return `**${content}**`;
  if (tag === 'em' || tag === 'i') return `*${content}*`;
  if (tag === 's' || tag === 'del') return `~~${content}~~`;
  if (tag === 'mark') return `==${content}==`;
  if (tag === 'code' && !classes.has('cm-content')) {
    const fence = inlineCodeFence(content);
    return `${fence}${content}${fence}`;
  }
  if (tag === 'a' && options.href) return `[${content}](${options.href})`;
  if (tag === 'blockquote') return `${prefixLines(content, '> ')}\n\n`;
  if (tag === 'hr') return '---\n\n';
  if (tag === 'li') {
    const marker = options.checked === undefined
      ? options.orderedIndex == null
        ? '- '
        : `${options.orderedIndex}. `
      : `- [${options.checked ? 'x' : ' '}] `;
    const lines = content.replace(/^\n+|\n+$/g, '').split('\n');
    return `${marker}${lines[0] ?? ''}${lines.slice(1).map((line) => `\n  ${line}`).join('')}\n`;
  }
  if (tag === 'p') return `${content}\n\n`;
  if (tag === 'br') return '\n';
  if (classes.has('cm-line')) return `${content}\n`;
  if (tag === 'ul' || tag === 'ol') return `${content.replace(/\n+$/g, '')}\n\n`;
  return content;
}

function elementOptions(element: Element): MarkdownElementOptions {
  const parent = element.parentElement;
  const orderedIndex = element.tagName === 'LI' && parent?.tagName === 'OL'
    ? Array.from(parent.children).filter((child) => child.tagName === 'LI').indexOf(element) +
      Number(parent.getAttribute('start') ?? 1)
    : null;
  const taskCheckbox = element.tagName === 'LI'
    ? element.querySelector<HTMLInputElement>(':scope > .gn-markdown-task-checkbox')
    : null;

  return {
    href: element.getAttribute('href'),
    wikilinkTarget: element.getAttribute('data-wikilink-target'),
    checked: taskCheckbox ? taskCheckbox.checked : undefined,
    orderedIndex,
    codeLanguage: element.hasAttribute('data-markdown-code-language')
      ? element.getAttribute('data-markdown-code-language')
      : undefined,
    classes: Array.from(element.classList)
  };
}

function serializeTable(table: Element) {
  const rows = Array.from(table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr'));
  if (rows.length === 0) return '';
  const serialized = rows.map((row) =>
    `| ${Array.from(row.children).map((cell) => serializeChildren(cell).trim()).join(' | ')} |`
  );
  const columns = rows[0].children.length;
  serialized.splice(1, 0, `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
  return `${serialized.join('\n')}\n\n`;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return /^\s*\n\s*$/.test(text) ? '' : text.replaceAll('\u00a0', ' ');
  }
  if (!(node instanceof Element)) return serializeChildren(node);
  if (node.tagName === 'TABLE') return serializeTable(node);
  if (node.classList.contains('gn-markdown-inline-citation')) return '';
  if (node.tagName === 'INPUT' && node.classList.contains('gn-markdown-task-checkbox')) {
    return '';
  }
  return wrapChatMarkdownElement(
    node.tagName,
    serializeChildren(node),
    elementOptions(node)
  );
}

function serializeChildren(node: Node) {
  return Array.from(node.childNodes).map(serializeNode).join('');
}

function commonElement(range: Range) {
  return range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
}

export function normalizeCopiedMarkdown(markdown: string) {
  return markdown
    .replaceAll('\r\n', '\n')
    .replaceAll('\u200b', '')
    .replace(/^\n+|\n+$/g, '');
}

/** Convert one rendered assistant selection back to the supported Markdown dialect. */
export function chatSelectionToMarkdown(
  selection: Selection,
  messageElement: HTMLElement
) {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (
    !messageElement.contains(range.startContainer) ||
    !messageElement.contains(range.endContainer)
  ) {
    return null;
  }

  const startElement = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  const endElement = range.endContainer instanceof Element
    ? range.endContainer
    : range.endContainer.parentElement;
  const surface = startElement?.closest<HTMLElement>('.gn-markdown-surface');
  if (!surface || endElement?.closest('.gn-markdown-surface') !== surface) return null;

  let markdown = serializeChildren(range.cloneContents());
  let ancestor = commonElement(range);
  while (ancestor && ancestor !== surface) {
    markdown = wrapChatMarkdownElement(
      ancestor.tagName,
      markdown,
      elementOptions(ancestor)
    );
    ancestor = ancestor.parentElement;
  }
  return normalizeCopiedMarkdown(markdown);
}
