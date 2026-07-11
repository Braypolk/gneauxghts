import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  contentClassBySyntaxNode,
  defaultWrapById,
  getWrapFormatIds,
  getWrapFormatSpec,
  INLINE_WRAP_FORMATS,
  markerNodeBySyntaxNode,
  syntaxNodesById,
  wrapSpecsById
} from './inlineFormatSpec';

const here = dirname(fileURLToPath(import.meta.url));
const inlineFormattingCss = readFileSync(join(here, 'inlineFormatting.css'), 'utf8');
const editorCss = readFileSync(join(here, '../editor/editor.css'), 'utf8');

describe('inlineFormatSpec', () => {
  it('keeps the canonical format catalog explicit', () => {
    expect(
      INLINE_WRAP_FORMATS.map((spec) => ({
        id: spec.id,
        defaultDelimiter: spec.defaultDelimiter,
        syntaxNode: spec.syntaxNode,
        concealStrategy: spec.concealStrategy,
        requiresCustomParser:
          'requiresCustomParser' in spec ? spec.requiresCustomParser : false
      }))
    ).toEqual([
      {
        id: 'bold',
        defaultDelimiter: { before: '**', after: '**' },
        syntaxNode: 'StrongEmphasis',
        concealStrategy: 'syntaxTreeChildren',
        requiresCustomParser: false
      },
      {
        id: 'italic',
        defaultDelimiter: { before: '*', after: '*' },
        syntaxNode: 'Emphasis',
        concealStrategy: 'syntaxTreeChildren',
        requiresCustomParser: false
      },
      {
        id: 'strikethrough',
        defaultDelimiter: { before: '~~', after: '~~' },
        syntaxNode: 'Strikethrough',
        concealStrategy: 'syntaxTreeChildren',
        requiresCustomParser: false
      },
      {
        id: 'highlight',
        defaultDelimiter: { before: '==', after: '==' },
        syntaxNode: 'Highlight',
        concealStrategy: 'syntaxTreeChildren',
        requiresCustomParser: true
      },
      {
        id: 'comment',
        defaultDelimiter: { before: '%%', after: '%%' },
        syntaxNode: 'InlineComment',
        concealStrategy: 'syntaxTreeChildren',
        requiresCustomParser: true
      },
      {
        id: 'code',
        defaultDelimiter: { before: '`', after: '`' },
        syntaxNode: 'InlineCode',
        concealStrategy: 'codeBlockDecorator',
        requiresCustomParser: false
      }
    ]);
    expect(getWrapFormatIds()).toEqual(INLINE_WRAP_FORMATS.map((spec) => spec.id));
    expect(getWrapFormatSpec('bold')).toBe(INLINE_WRAP_FORMATS[0]);
  });

  it('builds derived maps that round-trip from the catalog', () => {
    for (const spec of INLINE_WRAP_FORMATS) {
      expect(wrapSpecsById[spec.id]).toEqual(spec.delimiters);
      expect(defaultWrapById[spec.id]).toEqual(spec.defaultDelimiter);
      expect(syntaxNodesById[spec.id]).toEqual([spec.syntaxNode]);
      expect(contentClassBySyntaxNode[spec.syntaxNode]).toBe(spec.contentClass);
      expect(markerNodeBySyntaxNode[spec.syntaxNode]).toBe(spec.markerNode);
    }
  });

  it('wires every format content class to the appropriate stylesheet', () => {
    for (const spec of INLINE_WRAP_FORMATS) {
      const stylesheet =
        spec.concealStrategy === 'codeBlockDecorator' ? editorCss : inlineFormattingCss;
      expect(stylesheet).toContain(spec.contentClass);
    }
  });
});
