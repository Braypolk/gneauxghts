import type { Range } from '@codemirror/state';
import type { Decoration, EditorView } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';

// Context handed to each decorator while the markdown view plugin walks the
// syntax tree a single time. Decorators push ranges onto `decorations`; the
// view plugin sorts them and builds the final RangeSet. `selectionOverlaps`
// drives marker conceal (see conceal.ts).
export interface MarkdownDecorationContext {
  view: EditorView;
  decorations: Range<Decoration>[];
  selectionOverlaps: (from: number, to: number) => boolean;
}

// A decorator inspects a single syntax-tree node and contributes decorations.
// It returns nothing; matching on `node.name` is the decorator's responsibility.
export type MarkdownNodeDecorator = (ctx: MarkdownDecorationContext, node: SyntaxNodeRef) => void;
