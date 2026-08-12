import { describe, expect, it } from 'vitest';
import {
  normalizeCopiedMarkdown,
  wrapChatMarkdownElement
} from './chatSelectionMarkdown';

describe('chat selection Markdown', () => {
  it('restores headings and nested inline formatting', () => {
    const bold = wrapChatMarkdownElement('strong', 'Important');
    expect(wrapChatMarkdownElement('h1', bold)).toBe(
      '# **Important**\n\n'
    );
  });

  it('restores note dialect inline markers', () => {
    expect(wrapChatMarkdownElement('em', 'thought')).toBe('*thought*');
    expect(wrapChatMarkdownElement('s', 'removed')).toBe('~~removed~~');
    expect(wrapChatMarkdownElement('mark', 'remember')).toBe('==remember==');
    expect(
      wrapChatMarkdownElement('button', 'Alias', {
        wikilinkTarget: 'Notes/Project.md|Alias'
      })
    ).toBe('[[Notes/Project.md|Alias]]');
  });

  it('uses safe inline-code fences when the selection contains backticks', () => {
    expect(wrapChatMarkdownElement('code', 'value `inside`')).toBe(
      '``value `inside```'
    );
  });

  it('restores tasks, quotes, links, and fenced code', () => {
    expect(
      wrapChatMarkdownElement('li', 'Finished', { checked: true })
    ).toBe('- [x] Finished\n');
    expect(wrapChatMarkdownElement('blockquote', 'First\nSecond')).toBe(
      '> First\n> Second\n\n'
    );
    expect(
      wrapChatMarkdownElement('a', 'Source', { href: 'https://example.com/' })
    ).toBe('[Source](https://example.com/)');
    expect(
      wrapChatMarkdownElement('div', 'const value = 42;', {
        codeLanguage: 'ts'
      })
    ).toBe('```ts\nconst value = 42;\n```\n\n');
  });

  it('normalizes only boundary newlines without stripping Markdown spacing', () => {
    expect(normalizeCopiedMarkdown('\n\n# Title\n\n')).toBe('# Title');
  });
});
