import { tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import { findCmContentElement } from '$lib/features/notepad/editor/editorDom';

function findLastSelectionPoint(node: Node): { node: Node; offset: number } | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return { node, offset: node.textContent?.length ?? 0 };
  }

  for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
    const child = node.childNodes[index];
    const point = findLastSelectionPoint(child);
    if (point) return point;
  }

  if (node instanceof HTMLElement) {
    return { node, offset: node.childNodes.length };
  }

  return null;
}

export function focusInputAtEnd(input: HTMLInputElement | null) {
  if (!input) return;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

export function focusEditorAtDocumentLine(editorRoot: HTMLElement | null, lineNumber1Based: number) {
  const surface = findCmContentElement(editorRoot);
  if (!(surface instanceof HTMLElement)) return false;
  const view = EditorView.findFromDOM(surface);
  if (!view) return false;

  const line = Math.max(1, Math.min(lineNumber1Based, view.state.doc.lines));
  const info = view.state.doc.line(line);
  const anchor = Math.min(info.from, view.state.doc.length);

  view.focus();
  view.dispatch(view.state.update({ selection: { anchor }, scrollIntoView: false }));

  const coords = view.coordsAtPos(anchor);
  if (coords) {
    const scrollElement = view.scrollDOM;
    const scrollRect = scrollElement.getBoundingClientRect();
    const targetTop =
      scrollElement.scrollTop + (coords.top - scrollRect.top) - scrollRect.height * 0.25;
    const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    scrollElement.scrollTo({
      top: Math.max(0, Math.min(targetTop, maxScrollTop)),
      behavior: 'smooth'
    });
  }
  return true;
}

export function focusEditorTarget(editorRoot: HTMLElement | null, target: HTMLElement) {
  const surface = findCmContentElement(editorRoot);
  if (!(surface instanceof HTMLElement)) return;
  const view = EditorView.findFromDOM(surface) ?? EditorView.findFromDOM(target);
  if (!view) return;

  const point = findLastSelectionPoint(target);
  view.focus();

  if (!point) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const anchor = Math.max(0, Math.min(view.state.doc.length, view.posAtDOM(point.node, point.offset)));
  view.dispatch(view.state.update({ selection: { anchor }, scrollIntoView: true }));

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export async function focusEditorAtEnd(editorRoot: HTMLElement | null) {
  await tick();

  const surface = findCmContentElement(editorRoot);
  if (!(surface instanceof HTMLElement)) return;

  const view = EditorView.findFromDOM(surface);
  if (!view) return;

  const anchor = view.state.doc.length;
  view.dispatch(view.state.update({ selection: { anchor }, scrollIntoView: true }));
  view.focus();

  const point = findLastSelectionPoint(surface);
  const selectionTarget =
    point?.node instanceof HTMLElement ? point.node : point?.node.parentElement ?? surface;
  selectionTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function normalizePlainText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^\s*[-*+]\s+\[(?: |x|X)\]\s+/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

interface NormalizedEditorTarget {
  node: HTMLElement;
  text: string;
}

function normalizeTargets(nodes: readonly HTMLElement[]): NormalizedEditorTarget[] {
  return nodes.map((node) => ({
    node,
    text: normalizePlainText(node.textContent ?? '')
  }));
}

function getEditorBlocks(editorRoot: HTMLElement | null) {
  const surface = findCmContentElement(editorRoot);
  if (!surface) return [];

  return Array.from(surface.querySelectorAll('.cm-line')).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
}

function getEditorTargets(editorRoot: HTMLElement | null) {
  const surface = findCmContentElement(editorRoot);
  if (!surface) return [];

  const matches = normalizeTargets(
    Array.from(
      surface.querySelectorAll(
        '.cm-line.cm-gn-line-h1, .cm-line.cm-gn-line-h2, .cm-line.cm-gn-line-h3, .cm-line.cm-gn-line-h4, .cm-line.cm-gn-line-h5, .cm-line.cm-gn-line-h6, .cm-line.cm-gn-quote-line, .cm-line.cm-gn-code-block-line, .cm-line.cm-gn-list-line-ul, .cm-line.cm-gn-list-line-ol, .cm-line.cm-gn-task-line, .cm-line'
      )
    ).filter((node): node is HTMLElement => node instanceof HTMLElement)
  );

  const nonEmptyMatches = matches.filter(({ text }) => text !== '');
  if (nonEmptyMatches.length > 0) {
    return nonEmptyMatches;
  }

  return normalizeTargets(getEditorBlocks(editorRoot));
}

export function findBestEditorTarget(
  editorRoot: HTMLElement | null,
  matchText: string,
  preferredBlockIndex?: number
) {
  const normalizedNeedle = normalizePlainText(matchText);
  if (!normalizedNeedle) return null;

  if (preferredBlockIndex !== undefined) {
    const blocks = normalizeTargets(getEditorBlocks(editorRoot));
    const directMatch = blocks[preferredBlockIndex];
    if (directMatch?.text.includes(normalizedNeedle)) {
      return directMatch.node;
    }
  }

  const targets = getEditorTargets(editorRoot);
  const exactMatch = targets.find((target) => target.text === normalizedNeedle)?.node ?? null;

  if (exactMatch) {
    return exactMatch;
  }

  const partialMatches = targets.filter((target) => target.text.includes(normalizedNeedle));

  if (partialMatches.length === 0) {
    return null;
  }

  partialMatches.sort((left, right) => {
    return left.text.length - right.text.length;
  });

  return partialMatches[0]?.node ?? null;
}

export async function waitForEditorPaint() {
  await tick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
