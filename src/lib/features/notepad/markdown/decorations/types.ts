import type { Line, Range } from '@codemirror/state';
import type { Decoration, EditorView } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';

// Context handed to each decorator while the markdown view plugin walks the
// syntax tree a single time. Decorators push ranges onto `decorations`; the
// view plugin sorts them and builds the final RangeSet. `selectionOverlaps`
// drives marker conceal (see conceal.ts).
export interface MarkdownDecorationContext {
  view: EditorView;
  /** Merged windows for this build; absent only in standalone decorator tests. */
  visibleRanges?: readonly { from: number; to: number }[];
  decorations: Range<Decoration>[];
  selectionOverlaps: (from: number, to: number) => boolean;
}

// A decorator inspects a single syntax-tree node and contributes decorations.
// It returns nothing; matching on `node.name` is the decorator's responsibility.
export type MarkdownNodeDecorator = (ctx: MarkdownDecorationContext, node: SyntaxNodeRef) => void;

/** Iterate only lines touching a window, even when an enclosing block is huge. */
export function forEachVisibleLine(
  ctx: MarkdownDecorationContext,
  from: number,
  to: number,
  visit: (line: Line) => void
) {
  const { doc } = ctx.view.state;
  let previous = 0;
  for (const range of ctx.visibleRanges ?? [{ from: 0, to: doc.length }]) {
    const start = Math.max(from, range.from), end = Math.min(to, range.to);
    if (start > end) continue;
    const last = doc.lineAt(end).number;
    for (let number = Math.max(previous + 1, doc.lineAt(start).number); number <= last; number++) {
      visit(doc.line(number));
      previous = number;
    }
  }
}
