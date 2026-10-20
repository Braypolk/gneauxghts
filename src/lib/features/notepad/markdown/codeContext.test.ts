import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { createMarkdownLanguage } from './markdownLanguage';
import { isMarkdownCode } from './codeContext';

describe('shared Markdown code context', () => {
  for (const text of ['````\n```\nTARGET\n````', '~~~\n```\nTARGET\n~~~', '> ```\n> TARGET\n> ```', '- item\n\n    ```\n    TARGET\n    ```', '    TARGET', 'before `TARGET` after']) {
    it(`protects grammar-defined code in ${JSON.stringify(text)}`, () => {
      const state = EditorState.create({ doc: text, extensions: [createMarkdownLanguage()] });
      expect(isMarkdownCode(state, text.indexOf('TARGET') + 1)).toBe(true);
    });
  }
});
