import { Text } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { DocumentBody } from './documentBody';

describe('immutable document body', () => {
  it.each(['', 'a\r\nb\r\n', 'a\rb', '\n\n', '🙂\n\uFEFF'])('round trips exact boundary text %j', markdown => {
    const body = DocumentBody.fromMarkdown(markdown);
    expect(body.toMarkdown()).toBe(markdown);
    expect(body.text.toString()).toBe(markdown);
    expect(body.length).toBe(markdown.length);
  });

  it.each(['', ' \t\r\n\uFEFF\u00a0', '  a', '\n🙂', '\u200b'])('preserves trim semantics without flattening %j', markdown => {
    const body = DocumentBody.fromText(Text.of(markdown.split('\n')));
    const flatten = vi.spyOn(body.text, 'toString');
    try {
      expect(body.hasContent()).toBe(markdown.trim() !== '');
      expect(body.hasContent()).toBe(markdown.trim() !== '');
      expect(flatten).not.toHaveBeenCalled();
    } finally { flatten.mockRestore(); }
  });

  it('compares exact content and caches only the requested immutable snapshot', () => {
    const original = DocumentBody.fromMarkdown('one\ntwo\n');
    const edited = DocumentBody.fromText(original.text.replace(4, 7, Text.of(['new'])));
    const reverted = DocumentBody.fromText(edited.text.replace(4, 7, Text.of(['two'])));
    const flatten = vi.spyOn(edited.text, 'toString');
    try {
      expect(edited.equals(original)).toBe(false);
      expect(reverted.equals(original)).toBe(true);
      expect(flatten).not.toHaveBeenCalled();
      expect(edited.toMarkdown()).toBe('one\nnew\n');
      expect(edited.toMarkdown()).toBe('one\nnew\n');
      expect(flatten).toHaveBeenCalledTimes(1);
      expect(original.toMarkdown()).toBe('one\ntwo\n');
    } finally { flatten.mockRestore(); }
  });
});
