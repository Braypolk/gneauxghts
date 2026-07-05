/**
 * Canonical catalog for wrap-based inline markdown formats.
 *
 * To add a future Obsidian-style format (e.g. `%%comment%%`):
 * 1. Add an entry to `INLINE_WRAP_FORMATS`
 * 2. Add a Lezer parse extension if GFM does not provide the syntax node
 * 3. Wire the decorator (emphasis-style here, or codeBlocks for child markers)
 * 4. Add CSS for `contentClass`
 * 5. Expose in the selection toolbar via `inlineFormatting.ts`
 *
 * Link-style formats (`link`, `wikilink`, future footnotes) stay outside this
 * catalog — they use `Link` syntax nodes and regex unwrap logic instead of wraps.
 */

export type WrapFormatId =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'highlight'
  | 'comment'
  | 'code';

export interface DelimiterPair {
  before: string;
  after: string;
}

export interface InlineWrapFormatSpec {
  id: WrapFormatId;
  delimiters: readonly DelimiterPair[];
  defaultDelimiter: DelimiterPair;
  syntaxNode: string;
  markerNode: string;
  contentClass: string;
  /** Where marker conceal is implemented today */
  concealStrategy: 'syntaxTreeChildren' | 'codeBlockDecorator';
  /** Custom Lezer extension required for parsing (Obsidian-style syntax) */
  requiresCustomParser?: true;
}

export const INLINE_WRAP_FORMATS = [
  {
    id: 'bold',
    delimiters: [
      { before: '**', after: '**' },
      { before: '__', after: '__' }
    ],
    defaultDelimiter: { before: '**', after: '**' },
    syntaxNode: 'StrongEmphasis',
    markerNode: 'EmphasisMark',
    contentClass: 'cm-gn-strong',
    concealStrategy: 'syntaxTreeChildren'
  },
  {
    id: 'italic',
    delimiters: [
      { before: '*', after: '*' },
      { before: '_', after: '_' }
    ],
    defaultDelimiter: { before: '*', after: '*' },
    syntaxNode: 'Emphasis',
    markerNode: 'EmphasisMark',
    contentClass: 'cm-gn-emphasis',
    concealStrategy: 'syntaxTreeChildren'
  },
  {
    id: 'strikethrough',
    delimiters: [{ before: '~~', after: '~~' }],
    defaultDelimiter: { before: '~~', after: '~~' },
    syntaxNode: 'Strikethrough',
    markerNode: 'StrikethroughMark',
    contentClass: 'cm-gn-strikethrough',
    concealStrategy: 'syntaxTreeChildren'
  },
  {
    id: 'highlight',
    delimiters: [{ before: '==', after: '==' }],
    defaultDelimiter: { before: '==', after: '==' },
    syntaxNode: 'Highlight',
    markerNode: 'HighlightMark',
    contentClass: 'cm-gn-highlight',
    concealStrategy: 'syntaxTreeChildren',
    requiresCustomParser: true
  },
  {
    id: 'comment',
    delimiters: [{ before: '%%', after: '%%' }],
    defaultDelimiter: { before: '%%', after: '%%' },
    syntaxNode: 'InlineComment',
    markerNode: 'InlineCommentMark',
    contentClass: 'cm-gn-comment',
    concealStrategy: 'syntaxTreeChildren',
    requiresCustomParser: true
  },
  {
    id: 'code',
    delimiters: [{ before: '`', after: '`' }],
    defaultDelimiter: { before: '`', after: '`' },
    syntaxNode: 'InlineCode',
    markerNode: 'CodeMark',
    contentClass: 'cm-gn-code-inline',
    concealStrategy: 'codeBlockDecorator'
  }
] as const satisfies readonly InlineWrapFormatSpec[];

export function getWrapFormatSpec(id: WrapFormatId): InlineWrapFormatSpec {
  const spec = INLINE_WRAP_FORMATS.find((entry) => entry.id === id);
  if (!spec) {
    throw new Error(`Unknown wrap format: ${id}`);
  }
  return spec;
}

export function getWrapFormatIds(): readonly WrapFormatId[] {
  return INLINE_WRAP_FORMATS.map((entry) => entry.id);
}

function buildRecord<T>(
  entries: readonly InlineWrapFormatSpec[],
  select: (spec: InlineWrapFormatSpec) => T
): Record<WrapFormatId, T> {
  return Object.fromEntries(entries.map((spec) => [spec.id, select(spec)])) as Record<
    WrapFormatId,
    T
  >;
}

export const wrapSpecsById = buildRecord(INLINE_WRAP_FORMATS, (spec) => spec.delimiters);

export const defaultWrapById = buildRecord(INLINE_WRAP_FORMATS, (spec) => spec.defaultDelimiter);

export const syntaxNodesById = buildRecord(INLINE_WRAP_FORMATS, (spec) => [spec.syntaxNode]);

function buildSyntaxNodeMap<T>(
  entries: readonly InlineWrapFormatSpec[],
  select: (spec: InlineWrapFormatSpec) => T
): Record<string, T> {
  return Object.fromEntries(entries.map((spec) => [spec.syntaxNode, select(spec)]));
}

export const contentClassBySyntaxNode = buildSyntaxNodeMap(
  INLINE_WRAP_FORMATS,
  (spec) => spec.contentClass
);

export const markerNodeBySyntaxNode = buildSyntaxNodeMap(
  INLINE_WRAP_FORMATS,
  (spec) => spec.markerNode
);

export const emphasisWrapFormats = INLINE_WRAP_FORMATS.filter(
  (spec) => spec.concealStrategy === 'syntaxTreeChildren'
);
