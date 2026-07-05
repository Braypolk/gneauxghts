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
  it('defines complete entries for every wrap format', () => {
    for (const spec of INLINE_WRAP_FORMATS) {
      expect(spec.delimiters.length).toBeGreaterThan(0);
      expect(spec.syntaxNode).not.toBe('');
      expect(spec.markerNode).not.toBe('');
      expect(spec.contentClass).not.toBe('');
      expect(spec.defaultDelimiter.before).not.toBe('');
      expect(spec.defaultDelimiter.after).not.toBe('');
    }
  });

  it('has unique ids and syntax nodes', () => {
    const ids = INLINE_WRAP_FORMATS.map((spec) => spec.id);
    const syntaxNodes = INLINE_WRAP_FORMATS.map((spec) => spec.syntaxNode);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(syntaxNodes).size).toBe(syntaxNodes.length);
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

  it('exposes typed helpers for lookup and iteration', () => {
    expect(getWrapFormatSpec('bold').syntaxNode).toBe('StrongEmphasis');
    expect(getWrapFormatIds()).toEqual([
      'bold',
      'italic',
      'strikethrough',
      'highlight',
      'comment',
      'code'
    ]);
  });

  it('documents comment as requiring a custom parser', () => {
    expect(getWrapFormatSpec('comment').requiresCustomParser).toBe(true);
    expect(getWrapFormatSpec('comment').syntaxNode).toBe('InlineComment');
  });

  it('documents highlight as requiring a custom parser', () => {
    expect(getWrapFormatSpec('highlight').requiresCustomParser).toBe(true);
  });

  it('documents inline code as handled by the code block decorator', () => {
    expect(getWrapFormatSpec('code').concealStrategy).toBe('codeBlockDecorator');
  });

  it('references every emphasis content class in inlineFormatting.css', () => {
    for (const spec of INLINE_WRAP_FORMATS) {
      if (spec.concealStrategy === 'codeBlockDecorator') {
        continue;
      }
      expect(inlineFormattingCss).toContain(spec.contentClass);
    }
  });

  it('references inline code content class in editor.css', () => {
    expect(editorCss).toContain(getWrapFormatSpec('code').contentClass);
  });
});
