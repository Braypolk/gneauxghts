import { markdownLanguage } from '@codemirror/lang-markdown';
import type { EditorState, Text } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import type { Tree } from '@lezer/common';

// Text is immutable. Share the grammar result across command/table callers and
// across selection-only transactions without retaining retired documents.
const codeRanges = new WeakMap<Text, readonly { from: number; to: number }[]>();
export function markdownCodeRanges(doc: Text, publishedTree?: Tree): readonly { from: number; to: number }[] {
  const cached = codeRanges.get(doc);
  if (cached) return cached;
  const tree = publishedTree && publishedTree.length === doc.length ? publishedTree : markdownLanguage.parser.parse(doc.toString());
  const ranges: { from: number; to: number }[] = [];
  tree.iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) {
      ranges.push({ from: node.from, to: node.to }); return false;
    }
  } });
  codeRanges.set(doc, ranges);
  return ranges;
}
/** In input handlers use the installed parser and a bounded parse budget. If
 * it cannot establish context, decline the optional edit rather than alter code.
 */
export function isMarkdownCode(state: EditorState, from: number, to = from): boolean {
  const tree = ensureSyntaxTree(state, to, 25);
  if (!tree) return true;
  let code = false;
  tree.iterate({ from, to, enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name) &&
        (from === to ? from > node.from && from < node.to : from < node.to && to > node.from)) {
      code = true; return false;
    }
  } });
  return code;
}
