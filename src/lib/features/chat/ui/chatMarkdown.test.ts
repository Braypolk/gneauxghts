import { describe, expect, it } from 'vitest';
import {
  normalizeCodeLanguage,
  parseChatMarkdownBlocks,
  renderChatMarkdown
} from './chatMarkdown';

describe('chat Markdown', () => {
  it('renders the safe note dialect', () => {
    const html = renderChatMarkdown([
      '# Heading',
      '',
      '**Bold** ~~gone~~ ==marked==',
      '',
      '- [x] done',
      '- [ ] next',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '[[Notes/Project.md|Project]]'
    ].join('\n'));

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('<mark>marked</mark>');
    expect(html).toContain('class="gn-markdown-task-item"');
    expect(html).toContain('checked');
    expect(html).toContain('<table>');
    expect(html).toContain('data-wikilink-target="Notes/Project.md|Project"');
    expect(html).toContain('>Project</button>');
  });

  it('keeps checked, unchecked, and nested tasks in list structure', () => {
    const html = renderChatMarkdown(
      '- [ ] parent\n  - [x] nested\n- [x] complete'
    );

    expect(html.match(/class="gn-markdown-task-item"/g)).toHaveLength(3);
    expect(html.match(/type="checkbox" disabled/g)).toHaveLength(3);
    expect(html.match(/ checked/g)).toHaveLength(2);
    expect(html).toContain('<ul>\n<li class="gn-markdown-task-item">');
    expect(html.match(/<ul>/g)).toHaveLength(2);
  });

  it('escapes raw HTML and does not load Markdown images', () => {
    const html = renderChatMarkdown(
      '<script>alert(1)</script>\n\n![private](https://example.com/private.png)'
    );

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('gn-markdown-image-reference');
  });

  it('allows HTTP links while leaving unsafe and relative links literal', () => {
    const html = renderChatMarkdown(
      '[safe](https://example.com) [unsafe](javascript:alert(1)) [relative](/note)'
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="/note"');
  });

  it('splits top-level fences into stable CodeMirror blocks', () => {
    const blocks = parseChatMarkdownBlocks(
      'Before\n\n```ts\nconst answer = 42;\n```\n\nAfter\n\n```unknown\nvalue'
    );

    expect(blocks.map((block) => [block.key, block.type])).toEqual([
      ['html-0', 'html'],
      ['code-0', 'code'],
      ['html-1', 'html'],
      ['code-1', 'code']
    ]);
    expect(blocks[1]).toMatchObject({
      code: 'const answer = 42;\n',
      language: 'ts'
    });
    expect(blocks[3]).toMatchObject({ code: 'value', language: 'unknown' });
  });

  it('normalizes common fenced-language info strings', () => {
    expect(normalizeCodeLanguage('ts title="Example"')).toBe('ts');
    expect(normalizeCodeLanguage('{.python}')).toBe('python');
    expect(normalizeCodeLanguage('')).toBe('');
  });
});
