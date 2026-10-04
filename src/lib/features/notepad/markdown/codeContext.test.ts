import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { createMarkdownLanguage } from './markdownLanguage';
import { isMarkdownCode } from './codeContext';
import { collectPassiveTableRanges } from '../editor/passiveTableExtension';

describe('shared Markdown code context', () => {
  for (const text of ['````\n```\nTARGET\n````', '~~~\n```\nTARGET\n~~~', '> ```\n> TARGET\n> ```', '- item\n\n    ```\n    TARGET\n    ```', '    TARGET', 'before `TARGET` after']) {
    it(`protects grammar-defined code in ${JSON.stringify(text)}`, () => {
      const state = EditorState.create({ doc: text, extensions: [createMarkdownLanguage()] });
      expect(isMarkdownCode(state, text.indexOf('TARGET') + 1)).toBe(true);
    });
  }
  it('does not decorate table examples inside fences', () => {
    const doc = EditorState.create({ doc: '```\n| one | two |\n| --- | --- |\n```\n\n| real | table |\n| --- | --- |' }).doc;
    expect(collectPassiveTableRanges(doc).map(range => doc.lineAt(range.headerFrom).number)).toEqual([6]);
  });
});
