import { tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import { findCmContentElement } from '$lib/features/notepad/editor/editorDom';
import { editorScrollEffect } from '$lib/features/notepad/editor/editorScroll';

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

  view.dispatch({ selection: { anchor }, effects: editorScrollEffect(view, anchor) });
  view.focus();
  return true;
}

export async function focusEditorAtEnd(editorRoot: HTMLElement | null) {
  await tick();

  const surface = findCmContentElement(editorRoot);
  if (!(surface instanceof HTMLElement)) return;

  const view = EditorView.findFromDOM(surface);
  if (!view) return;

  const anchor = view.state.doc.length;
  // CodeMirror owns the end position so virtualized content need not be in DOM.
  view.dispatch(view.state.update({ selection: { anchor }, effects: editorScrollEffect(view, anchor) }));
  view.focus();
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

export async function waitForEditorPaint() {
  await tick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** Resolves against the entire document, including lines outside the rendered viewport.
 * A preferred line is only a hint: its text must still match. Ambiguous stale hints
 * never choose an arbitrary occurrence. Offsets returned here are UTF-16.
 */
export function resolveEditorTextTarget(doc: Text, matchText: string, preferredLine?: number): number | null {
  const needle = normalizePlainText(matchText);
  if (!needle) return null;
  const candidates: { from: number; line: number; exact: boolean }[] = [];
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    const text = normalizePlainText(line.text);
    if (text.includes(needle)) candidates.push({ from: line.from, line: number, exact: text === needle });
  }
  if (!candidates.length) {
    // Excerpts can span wrapped Markdown paragraphs. Resolve their source block
    // as well, without requiring any of its lines to have DOM representation.
    let firstLine = 1;
    for (let number = 1; number <= doc.lines + 1; number += 1) {
      if (number <= doc.lines && doc.line(number).text.trim()) continue;
      if (number > firstLine) {
        const first = doc.line(firstLine);
        const text = normalizePlainText(doc.sliceString(first.from, doc.line(number - 1).to));
        if (text.includes(needle)) candidates.push({ from: first.from, line: firstLine, exact: text === needle });
      }
      firstLine = number + 1;
    }
  }
  const preferred = candidates.find((candidate) => candidate.line === preferredLine);
  if (preferred) return preferred.from;
  const exact = candidates.filter((candidate) => candidate.exact);
  const matches = exact.length ? exact : candidates;
  return matches.length === 1 ? matches[0].from : null;
}

export function revealEditorTextTarget(
  editorRoot: HTMLElement | null,
  matchText: string,
  { preferredLine, focus = true }: { preferredLine?: number; focus?: boolean } = {}
): boolean {
  const surface = findCmContentElement(editorRoot);
  if (!(surface instanceof HTMLElement)) return false;
  const view = EditorView.findFromDOM(surface);
  if (!view) return false;
  const anchor = resolveEditorTextTarget(view.state.doc, matchText, preferredLine);
  if (anchor === null) return false;
  view.dispatch({
    ...(focus ? { selection: { anchor } } : {}),
    effects: editorScrollEffect(view, anchor)
  });
  if (focus) view.focus();
  return true;
}

/** Citation quotes are exact authored text, never fuzzy search hints. */
export function resolveEditorCitationTarget(doc: Text, quote: string): { from: number; to: number } | null {
  if (!quote.trim()) return null;
  const text = doc.toString(), from = text.indexOf(quote);
  if (from < 0 || text.indexOf(quote, from + 1) >= 0) return null;
  return { from, to: from + quote.length };
}

export function revealEditorCitationTarget(editorRoot: HTMLElement | null, quote: string): boolean {
  const surface = findCmContentElement(editorRoot);
  if (!(surface instanceof HTMLElement)) return false;
  const view = EditorView.findFromDOM(surface);
  if (!view) return false;
  const range = resolveEditorCitationTarget(view.state.doc, quote);
  if (!range) return false;
  view.dispatch({ selection: { anchor: range.from, head: range.to }, effects: editorScrollEffect(view, range.from) });
  view.focus();
  return true;
}
