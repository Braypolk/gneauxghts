import { Decoration } from '@codemirror/view';

import { parseWikilink } from '$lib/features/notepad/wikilinks/parse';
import type { MarkdownDecorationContext, MarkdownNodeDecorator } from './types';

const concealTargetAndSeparator = Decoration.replace({ gnAtomic: true });

function selectionIntersectsWikilink(
  ctx: MarkdownDecorationContext,
  from: number,
  to: number
) {
  return ctx.view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.head > from && range.head < to;
    }
    return range.from < to && range.to > from;
  });
}

export const decorateWikilink: MarkdownNodeDecorator = (ctx, node) => {
  if (node.name !== 'Wikilink') {
    return;
  }

  const rawTarget = ctx.view.state.sliceDoc(node.from + 2, node.to - 2).trim();
  if (!rawTarget) {
    return;
  }

  ctx.decorations.push(
    Decoration.mark({
      class: 'gn-wikilink',
      attributes: {
        'data-wikilink-target': rawTarget
      }
    }).range(node.from, node.to)
  );

  const parsed = parseWikilink(rawTarget);
  if (!parsed.alias || selectionIntersectsWikilink(ctx, node.from, node.to)) {
    return;
  }

  const target = node.node.getChild('WikilinkTarget');
  const alias = node.node.getChild('WikilinkAlias');
  if (!target || !alias || alias.from <= target.from) {
    return;
  }

  // Keep the actual `[[alias]]` document characters visible. Only the target
  // and pipe are concealed, so clicking the alias naturally places CodeMirror's
  // cursor inside the source range and reveals the complete wikilink.
  ctx.decorations.push(concealTargetAndSeparator.range(target.from, alias.from));
  if (alias.to < node.to - 2) {
    ctx.decorations.push(concealTargetAndSeparator.range(alias.to, node.to - 2));
  }
};
