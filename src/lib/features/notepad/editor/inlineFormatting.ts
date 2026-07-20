import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { dispatchEditorChange } from '$lib/features/notepad/editor/editorDispatch';
import {
  defaultWrapById,
  syntaxNodesById,
  wrapSpecsById,
  type WrapFormatId
} from '$lib/features/notepad/markdown/inlineFormatSpec';
import {
  formatShortcutBinding,
  getKeyboardShortcutBinding,
  type KeyboardShortcutId
} from '$lib/keyboardShortcuts.svelte';

export type InlineFormatId =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'highlight'
  | 'comment'
  | 'code'
  | 'link'
  | 'wikilink';

interface WrapSpec {
  before: string;
  after: string;
}

interface DetectedWrap extends WrapSpec {
  unwrapped: string;
}

interface EnclosingFormat {
  nodeFrom: number;
  nodeTo: number;
  wrap: DetectedWrap;
}

function applySpec(
  view: EditorView,
  changes: { from: number; to: number; insert: string },
  selection: { anchor: number; head?: number }
) {
  return dispatchEditorChange(view, {
    changes,
    selection: { anchor: selection.anchor, head: selection.head ?? selection.anchor },
    scrollIntoView: true
  });
}

function detectWrap(text: string, specs: readonly WrapSpec[]): DetectedWrap | null {
  const sorted = [...specs].sort(
    (left, right) =>
      right.before.length + right.after.length - (left.before.length + left.after.length)
  );

  for (const spec of sorted) {
    if (
      !text.startsWith(spec.before) ||
      !text.endsWith(spec.after) ||
      text.length < spec.before.length + spec.after.length
    ) {
      continue;
    }

    // Avoid treating `**bold**` as single-asterisk italic delimiters.
    if (
      spec.before.length === 1 &&
      text.startsWith(spec.before.repeat(2)) &&
      spec.before === spec.after
    ) {
      continue;
    }

    return {
      ...spec,
      unwrapped: text.slice(spec.before.length, text.length - spec.after.length)
    };
  }

  return null;
}

function selectionWithinWrappedContent(
  from: number,
  to: number,
  nodeFrom: number,
  wrap: DetectedWrap
): boolean {
  const contentFrom = nodeFrom + wrap.before.length;
  const contentTo = nodeFrom + wrap.unwrapped.length + wrap.before.length;
  return from >= contentFrom && to <= contentTo && contentTo > contentFrom;
}

function findEnclosingFormatNode(
  state: EditorState,
  from: number,
  to: number,
  nodeNames: readonly string[],
  specs: readonly WrapSpec[]
): EnclosingFormat | null {
  let best: EnclosingFormat | null = null;
  let bestSize = Number.POSITIVE_INFINITY;

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (!nodeNames.includes(node.name)) {
        return;
      }

      const wrap = detectWrap(state.sliceDoc(node.from, node.to), specs);
      if (!wrap || !selectionWithinWrappedContent(from, to, node.from, wrap)) {
        return;
      }

      const size = node.to - node.from;
      if (size < bestSize) {
        bestSize = size;
        best = { nodeFrom: node.from, nodeTo: node.to, wrap };
      }
    }
  });

  return best;
}

function mapSelectionAfterUnwrap(
  from: number,
  to: number,
  nodeFrom: number,
  wrap: DetectedWrap
): { anchor: number; head: number } {
  const contentFrom = nodeFrom + wrap.before.length;
  const anchor = nodeFrom + (from - contentFrom);
  const head = nodeFrom + (to - contentFrom);
  return { anchor, head };
}

function toggleWrap(
  view: EditorView,
  specs: readonly WrapSpec[],
  fallback: WrapSpec,
  syntaxNodeNames: readonly string[]
) {
  const selection = view.state.selection.main;
  if (selection.empty) {
    return false;
  }

  const { from, to } = selection;
  const text = view.state.sliceDoc(from, to);
  const directWrap = detectWrap(text, specs);

  if (directWrap) {
    return applySpec(
      view,
      { from, to, insert: directWrap.unwrapped },
      { anchor: from, head: from + directWrap.unwrapped.length }
    );
  }

  const enclosing = findEnclosingFormatNode(view.state, from, to, syntaxNodeNames, specs);
  if (enclosing) {
    const { wrap, nodeFrom, nodeTo } = enclosing;
    const mapped = mapSelectionAfterUnwrap(from, to, nodeFrom, wrap);
    return applySpec(
      view,
      { from: nodeFrom, to: nodeTo, insert: wrap.unwrapped },
      mapped
    );
  }

  const wrapFallback =
    fallback.before === '*' &&
    findEnclosingFormatNode(view.state, from, to, syntaxNodesById.bold, wrapSpecsById.bold)
      ? { before: '_', after: '_' }
      : fallback;

  const wrapped = `${wrapFallback.before}${text}${wrapFallback.after}`;
  return applySpec(
    view,
    { from, to, insert: wrapped },
    { anchor: from + wrapFallback.before.length, head: to + wrapFallback.before.length }
  );
}

function unwrapLinkText(text: string): string | null {
  const wikiMatch = text.match(/^\[\[([\s\S]*?)\]\]$/);
  if (wikiMatch) {
    return wikiMatch[1] ?? '';
  }

  const bracketWikiMatch = text.match(/^\[([\s\S]*?)\]$/);
  if (bracketWikiMatch) {
    return bracketWikiMatch[1] ?? '';
  }

  const linkMatch = text.match(/^\[([\s\S]*?)\]\(([\s\S]*?)\)$/);
  if (linkMatch) {
    return linkMatch[1] ?? '';
  }

  return null;
}

function isWikiLinkNode(state: EditorState, nodeFrom: number, nodeTo: number): boolean {
  return (
    nodeFrom > 0 &&
    nodeTo < state.doc.length &&
    state.sliceDoc(nodeFrom - 1, nodeFrom) === '[' &&
    state.sliceDoc(nodeTo, nodeTo + 1) === ']'
  );
}

function findEnclosingLinkNode(
  state: EditorState,
  from: number,
  to: number,
  kind: 'link' | 'wikilink'
): { nodeFrom: number; nodeTo: number; inner: string } | null {
  let best: { nodeFrom: number; nodeTo: number; inner: string } | null = null;
  let bestSize = Number.POSITIVE_INFINITY;

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'Link') {
        return;
      }

      const nodeText = state.sliceDoc(node.from, node.to);
      const isWiki = isWikiLinkNode(state, node.from, node.to);
      if (kind === 'wikilink' ? !isWiki : isWiki) {
        return;
      }

      const inner = unwrapLinkText(nodeText);
      if (inner === null) {
        return;
      }

      const labelFrom = node.from + 1;
      const labelTo = isWiki ? node.to - 1 : labelFrom + inner.length;
      if (from < labelFrom || to > labelTo) {
        return;
      }

      const size = isWiki ? node.to - node.from + 2 : node.to - node.from;
      if (size < bestSize) {
        bestSize = size;
        best = {
          nodeFrom: isWiki ? node.from - 1 : node.from,
          nodeTo: isWiki ? node.to + 1 : node.to,
          inner
        };
      }
    }
  });

  return best;
}

function applyLink(view: EditorView) {
  const selection = view.state.selection.main;
  if (selection.empty) {
    return false;
  }

  const { from, to } = selection;
  const text = view.state.sliceDoc(from, to);
  const directInner = unwrapLinkText(text);
  if (directInner !== null && !text.startsWith('[[')) {
    return applySpec(view, { from, to, insert: directInner }, { anchor: from, head: from + directInner.length });
  }

  const enclosing = findEnclosingLinkNode(view.state, from, to, 'link');
  if (enclosing) {
    const labelFrom = enclosing.nodeFrom + 1;
    const anchor = enclosing.nodeFrom + (from - labelFrom);
    const head = enclosing.nodeFrom + (to - labelFrom);
    return applySpec(
      view,
      { from: enclosing.nodeFrom, to: enclosing.nodeTo, insert: enclosing.inner },
      { anchor, head }
    );
  }

  const insert = `[${text}]()`;
  const urlStart = from + text.length + 3;
  return applySpec(view, { from, to, insert }, { anchor: urlStart, head: urlStart });
}

function applyWikilink(view: EditorView) {
  const selection = view.state.selection.main;
  if (selection.empty) {
    return false;
  }

  const { from, to } = selection;
  const text = view.state.sliceDoc(from, to);
  const directInner = unwrapLinkText(text);
  if (directInner !== null && text.startsWith('[[')) {
    return applySpec(view, { from, to, insert: directInner }, { anchor: from, head: from + directInner.length });
  }

  const enclosing = findEnclosingLinkNode(view.state, from, to, 'wikilink');
  if (enclosing) {
    const labelFrom = enclosing.nodeFrom + 2;
    const anchor = enclosing.nodeFrom + (from - labelFrom);
    const head = enclosing.nodeFrom + (to - labelFrom);
    return applySpec(
      view,
      { from: enclosing.nodeFrom, to: enclosing.nodeTo, insert: enclosing.inner },
      { anchor, head }
    );
  }

  const trimmed = text.trim();
  const insert = trimmed ? `[[${trimmed}]]` : '[[]]';
  const anchor = from + 2;
  return applySpec(view, { from, to, insert }, { anchor, head: anchor + (trimmed ? trimmed.length : 0) });
}

export function isInlineFormatActive(
  state: EditorState,
  from: number,
  to: number,
  id: InlineFormatId
): boolean {
  if (from === to) {
    return false;
  }

  if (id === 'link' || id === 'wikilink') {
    const text = state.sliceDoc(from, to);
    const directInner = unwrapLinkText(text);
    if (id === 'link') {
      return (directInner !== null && !text.startsWith('[[')) || findEnclosingLinkNode(state, from, to, 'link') !== null;
    }
    return (directInner !== null && text.startsWith('[[')) || findEnclosingLinkNode(state, from, to, 'wikilink') !== null;
  }

  const wrapId = id as WrapFormatId;
  const text = state.sliceDoc(from, to);
  if (detectWrap(text, wrapSpecsById[wrapId])) {
    return true;
  }

  return (
    findEnclosingFormatNode(state, from, to, syntaxNodesById[wrapId], wrapSpecsById[wrapId]) !== null
  );
}

export function getActiveInlineFormats(
  state: EditorState,
  from: number,
  to: number
): readonly InlineFormatId[] {
  return inlineFormatActions
    .map((action) => action.id)
    .filter((id) => isInlineFormatActive(state, from, to, id));
}

export function applyInlineFormat(view: EditorView, id: InlineFormatId) {
  if (id === 'link') {
    return applyLink(view);
  }

  if (id === 'wikilink') {
    return applyWikilink(view);
  }

  const wrapId = id as WrapFormatId;
  return toggleWrap(
    view,
    wrapSpecsById[wrapId],
    defaultWrapById[wrapId],
    syntaxNodesById[wrapId]
  );
}

export const inlineFormatActions: readonly {
  id: InlineFormatId;
  label: string;
}[] = [
  { id: 'bold', label: 'Bold' },
  { id: 'italic', label: 'Italic' },
  { id: 'strikethrough', label: 'Strikethrough' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'code', label: 'Code' },
  { id: 'link', label: 'Link' },
  { id: 'wikilink', label: 'Wikilink' }
];

const INLINE_FORMAT_SHORTCUT_IDS: Partial<Record<InlineFormatId, KeyboardShortcutId>> = {
  bold: 'editorBold',
  italic: 'editorItalic',
  link: 'editorLink'
};

export function getInlineFormatShortcutLabel(id: InlineFormatId): string | undefined {
  const shortcutId = INLINE_FORMAT_SHORTCUT_IDS[id];
  if (!shortcutId) {
    return undefined;
  }

  const binding = getKeyboardShortcutBinding(shortcutId);
  if (!binding) {
    return undefined;
  }

  return formatShortcutBinding(binding);
}

export const inlineFormatIcons: Record<InlineFormatId, string> = {
  bold: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>`,
  italic: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>`,
  strikethrough: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`,
  highlight: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h3l6-6"/><path d="m22 6-8.5 8.5-3-3L19 3z"/></svg>`,
  comment: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  code: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  link: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  wikilink: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 9H6.75A3.75 3.75 0 1 0 6.75 16.5H10"/><path d="M14 15H17.25A3.75 3.75 0 1 0 17.25 7.5H14"/><path d="M8.5 12h7"/></svg>`
};
