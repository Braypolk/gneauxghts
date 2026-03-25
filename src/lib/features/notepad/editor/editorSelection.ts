import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';

export function isDocEmpty(doc: ProseMirrorNode) {
  return doc.childCount <= 1 && !doc.firstChild?.content.size;
}

export function isInCodeContext(selection: Selection) {
  const { $from } = selection;
  if ($from.parent.type.name === 'code_block') {
    return true;
  }

  return $from.marks().some((mark) => mark.type.name === 'code');
}

export function isInList(selection: Selection) {
  const { $from } = selection;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const nodeName = $from.node(depth).type.name;
    if (nodeName === 'list_item' || nodeName === 'bullet_list' || nodeName === 'ordered_list') {
      return true;
    }
  }

  return false;
}
