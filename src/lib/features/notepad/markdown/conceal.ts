import type { EditorView } from '@codemirror/view';

// Shared "reveal markdown syntax near the cursor" predicate used by the inline,
// heading, link, quote, hr, and code decorators. A node's raw markdown markers
// are concealed unless a selection range overlaps the node — at which point the
// markers are revealed so they can be edited. This matches the conceal model
// chosen in the migration plan: reveal on active node + selection overlap.
export function selectionOverlaps(view: EditorView, from: number, to: number): boolean {
  for (const range of view.state.selection.ranges) {
    if (range.from <= to && range.to >= from) {
      return true;
    }
  }
  return false;
}

// Whether the cursor (or any selection range) touches the given line range.
// Used by list/quote line-level decorations where reveal is keyed to the line
// rather than an inline node.
export function selectionTouchesLine(view: EditorView, lineFrom: number, lineTo: number): boolean {
  return selectionOverlaps(view, lineFrom, lineTo);
}
