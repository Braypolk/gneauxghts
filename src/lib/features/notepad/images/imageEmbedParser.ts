import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { SyntaxNode } from '@lezer/common';
import { obsidianMarkdownExtensions } from '../markdown/obsidianMarkdownExtensions';

const parser = markdown({ base: markdownLanguage, extensions: [obsidianMarkdownExtensions] }).language.parser;
const imageFile = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const sizePattern = /(?<!\\)\|(\d+(?:x\d*)?|x\d+)\s*$/;
export interface ParsedImageEmbedTarget { fileName: string; width: number | null; height: number | null }
export interface ImageEmbedMatch {
  from: number; to: number; target: ParsedImageEmbedTarget; widgetKey: string;
  source: string; syntax: 'wiki' | 'markdown'; labelFrom: number; labelTo: number;
  sizeFrom: number; sizeTo: number; destinationFrom: number; destinationTo: number;
  assetName: string | null; error: string | null;
  /** Collapsed/shortcut references need an explicit original label when sizing. */
  referenceLabel: string | null;
}
export function formatImageEmbedTarget(target: ParsedImageEmbedTarget) {
  const size = target.width != null ? `${target.width}${target.height != null ? `x${target.height}` : ''}`
    : target.height != null ? `x${target.height}` : '';
  return `![[${target.fileName}${size ? `|${size}` : ''}]]`;
}
export function resolveImageAssetName(raw: string): string | null {
  let name: string;
  try { name = decodeURIComponent(raw.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')); }
  catch { return null; }
  if (name.startsWith('assets/')) name = name.slice(7);
  if (!name || /[:\\\x00-\x1f?#]/.test(name)) return null;
  const parts = name.split('/');
  return parts.every(part => part && part !== '.' && part !== '..') ? name : null;
}
function normalizedLabel(label: string) { return label.trim().replace(/\s+/g, ' ').toLowerCase(); }
function children(node: SyntaxNode, name: string) {
  const nodes: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === name) nodes.push(child);
  return nodes;
}
function unbracket(value: string) { return value.replace(/^<|>$/g, ''); }
export function parseImageEmbeds(text: string): ImageEmbedMatch[] {
  const tree = parser.parse(text);
  // Inline parsers stop at paragraph boundaries; Obsidian comments may cross them.
  const literal: { from: number; to: number }[] = [];
  tree.iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock'].includes(node.name)) {
      literal.push({ from: node.from, to: node.to }); return false;
    }
  }});
  const comments: { from: number; to: number }[] = [];
  let opening: number | null = null;
  for (const match of text.matchAll(/(?<!\\)%%/g)) {
    const position = match.index!;
    if (literal.some(range => position >= range.from && position < range.to)) continue;
    if (opening == null) opening = position;
    else { comments.push({ from: opening, to: position + 2 }); opening = null; }
  }
  if (opening != null) comments.push({ from: opening, to: text.length });
  const hidden = (from: number) => comments.some(range => from >= range.from && from < range.to);
  const definitions = new Map<string, { from: number; to: number }>();
  tree.iterate({ enter(node) {
    if (node.name !== 'LinkReference' || hidden(node.from)) return;
    const label = children(node.node, 'LinkLabel')[0];
    const url = children(node.node, 'URL')[0];
    if (label && url) {
      const key = normalizedLabel(text.slice(label.from + 1, label.to - 1));
      if (!definitions.has(key)) definitions.set(key, { from: url.from, to: url.to });
    }
  }});
  const results: ImageEmbedMatch[] = [];
  tree.iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'InlineComment', 'HTMLBlock', 'CommentBlock'].includes(node.name)) return false;
    if (node.name !== 'WikiImage' && node.name !== 'Image') return;
    if (hidden(node.from)) return false;
    const source = text.slice(node.from, node.to);
    const wiki = node.name === 'WikiImage';
    const marks = children(node.node, 'LinkMark');
    const labelFrom = node.from + (wiki ? 3 : 2);
    const labelTo = wiki ? node.to - 2 : marks.find(mark => text.slice(mark.from, mark.to) === ']')?.from;
    if (labelTo == null) return false;
    const label = text.slice(labelFrom, labelTo);
    const size = label.match(sizePattern);
    const sizeFrom = size ? labelFrom + size.index! : labelTo;
    const value = size?.[1] ?? '';
    const [w, h] = value.split('x');
    const width = /^\d+$/.test(w) && +w > 0 ? +w : null;
    const height = h && /^\d+$/.test(h) && +h > 0 ? +h : null;
    let destinationFrom: number, destinationTo: number;
    let referenceLabel: string | null = null;
    if (wiki) { destinationFrom = labelFrom; destinationTo = sizeFrom; }
    else {
      const url = children(node.node, 'URL')[0];
      if (url) { destinationFrom = url.from; destinationTo = url.to; }
      else {
        const ref = children(node.node, 'LinkLabel')[0];
        const explicit = ref ? text.slice(ref.from + 1, ref.to - 1) : '';
        const original = explicit || label;
        const definition = definitions.get(normalizedLabel(original));
        if (!definition) return false;
        destinationFrom = definition.from; destinationTo = definition.to;
        if (!explicit) referenceLabel = original;
      }
    }
    const fileName = unbracket(text.slice(destinationFrom, destinationTo).trim());
    if (!imageFile.test(fileName)) return false;
    const assetName = resolveImageAssetName(fileName);
    results.push({ from: node.from, to: node.to, source, syntax: wiki ? 'wiki' : 'markdown',
      target: { fileName, width, height }, labelFrom, labelTo, sizeFrom, sizeTo: labelTo,
      destinationFrom, destinationTo, assetName, referenceLabel,
      error: assetName ? null : 'This image is outside the local assets folder.',
      widgetKey: `image:${node.from}:${fileName}` });
    return false;
  }});
  return results;
}
export function forEachImageEmbed(text: string, callback: (image: ImageEmbedMatch) => void) {
  parseImageEmbeds(text).forEach(callback);
}
export function isPositionInsideCodeFence(text: string, offset: number) {
  const node = parser.parse(text).resolveInner(offset, 1);
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (current.name === 'FencedCode' || current.name === 'CodeBlock') return true;
  }
  return false;
}
/** Patch only the size suffix; destinations, titles, encoding and labels stay authored. */
export function imageWidthChanges(image: ImageEmbedMatch, width: number | null) {
  const changes = [{ from: image.sizeFrom, to: image.sizeTo, insert: width == null ? '' : `|${Math.round(width)}` }];
  if (image.referenceLabel && (width != null || image.sizeFrom !== image.sizeTo)) {
    const collapsed = image.source.endsWith('[]');
    changes.push({ from: image.to - (collapsed ? 2 : 0), to: image.to, insert: `[${image.referenceLabel}]` });
  }
  return changes;
}
