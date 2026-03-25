import { tick } from 'svelte';

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

export function focusEditorTarget(editorRoot: HTMLElement | null, target: HTMLElement) {
  const proseMirror = editorRoot?.querySelector('.ProseMirror');
  if (!(proseMirror instanceof HTMLElement)) return;

  const point = findLastSelectionPoint(target);
  proseMirror.focus({ preventScroll: true });

  if (!point) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export async function focusEditorAtEnd(editorRoot: HTMLElement | null) {
  await tick();

  const proseMirror = editorRoot?.querySelector('.ProseMirror');
  if (!(proseMirror instanceof HTMLElement)) return;

  proseMirror.focus();

  const point = findLastSelectionPoint(proseMirror);
  const selection = window.getSelection();
  if (!point || !selection) return;

  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  const selectionTarget =
    point.node instanceof HTMLElement ? point.node : point.node.parentElement ?? proseMirror;
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

function getEditorBlocks(editorRoot: HTMLElement | null) {
  const proseMirror = editorRoot?.querySelector('.ProseMirror');
  if (!proseMirror) return [];

  return Array.from(proseMirror.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
}

function getEditorTargets(editorRoot: HTMLElement | null) {
  const proseMirror = editorRoot?.querySelector('.ProseMirror');
  if (!proseMirror) return [];

  const matches = Array.from(
    proseMirror.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6, blockquote, pre')
  ).filter((node): node is HTMLElement => node instanceof HTMLElement);

  const nonEmptyMatches = matches.filter((node) => normalizePlainText(node.textContent ?? '') !== '');
  if (nonEmptyMatches.length > 0) {
    return nonEmptyMatches;
  }

  return getEditorBlocks(editorRoot);
}

export function findBestEditorTarget(
  editorRoot: HTMLElement | null,
  matchText: string,
  preferredBlockIndex?: number
) {
  const normalizedNeedle = normalizePlainText(matchText);
  if (!normalizedNeedle) return null;

  if (preferredBlockIndex !== undefined) {
    const blocks = getEditorBlocks(editorRoot);
    const directMatch = blocks[preferredBlockIndex];
    if (directMatch && normalizePlainText(directMatch.textContent ?? '').includes(normalizedNeedle)) {
      return directMatch;
    }
  }

  const targets = getEditorTargets(editorRoot);
  const exactMatch =
    targets.find((target) => normalizePlainText(target.textContent ?? '') === normalizedNeedle) ??
    null;

  if (exactMatch) {
    return exactMatch;
  }

  const partialMatches = targets.filter((target) =>
    normalizePlainText(target.textContent ?? '').includes(normalizedNeedle)
  );

  if (partialMatches.length === 0) {
    return null;
  }

  partialMatches.sort((left, right) => {
    const leftLength = normalizePlainText(left.textContent ?? '').length;
    const rightLength = normalizePlainText(right.textContent ?? '').length;
    return leftLength - rightLength;
  });

  return partialMatches[0] ?? null;
}

export async function waitForEditorPaint() {
  await tick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
