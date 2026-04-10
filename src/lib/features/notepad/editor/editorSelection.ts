import type { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';

interface AncestorNodeMatch {
  node: ProseMirrorNode;
  depth: number;
  start: number;
  pos: number;
}

export function findAncestorNode(
  $pos: ResolvedPos,
  predicate: (node: ProseMirrorNode) => boolean
): AncestorNodeMatch | null {
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth);
    if (predicate(node)) {
      return {
        node,
        depth,
        start: depth > 0 ? $pos.start(depth) : 0,
        pos: depth > 0 ? $pos.before(depth) : 0
      };
    }
  }

  return null;
}

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
