import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * Context for the block under the gutter handle (used to move selection before opening the slash menu).
 */
export interface BlockContext {
  targetPos: number;
  currentTypeId: string | null;
}

function getTextblockRangeAtPos(doc: ProseMirrorNode, pos: number) {
  const maxPos = Math.max(1, doc.nodeSize - 2);
  const $pos = doc.resolve(Math.max(1, Math.min(pos, maxPos)));

  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (node.isTextblock) {
      return {
        from: $pos.start(depth),
        to: $pos.end(depth)
      };
    }
  }

  return {
    from: $pos.pos,
    to: $pos.pos
  };
}

export function selectionTouchesBlock(
  doc: ProseMirrorNode,
  selection: { anchor: number; head: number },
  pos: number
) {
  const start = Math.min(selection.anchor, selection.head);
  const end = Math.max(selection.anchor, selection.head);
  const blockRange = getTextblockRangeAtPos(doc, pos);
  return end >= blockRange.from && start <= blockRange.to;
}

/**
 * Resolve which document position and block-type id correspond to the block handle for this row.
 */
export function resolveBlockContext(
  view: EditorView,
  _editorRoot: HTMLDivElement,
  handleButton: HTMLElement
): BlockContext | null {
  const blockHandle = handleButton.closest<HTMLElement>('.notepad-block-handle');
  const blockPos = Number(blockHandle?.dataset.blockPos);
  if (!Number.isFinite(blockPos)) return null;

  const node = view.state.doc.nodeAt(blockPos);
  if (!node) return null;

  if (node.type.name === 'heading') {
    return { targetPos: blockPos + node.nodeSize - 1, currentTypeId: `heading${node.attrs.level}` };
  }

  if (node.type.name === 'code_block') {
    return { targetPos: blockPos + 1, currentTypeId: 'code' };
  }

  if (node.type.name === 'list_item') {
    const $pos = view.state.doc.resolve(Math.min(blockPos + 1, view.state.doc.nodeSize - 2));
    for (let depth = $pos.depth; depth >= 1; depth -= 1) {
      if ($pos.before(depth) !== blockPos || $pos.node(depth).type.name !== 'list_item') {
        continue;
      }

      const innerPos = $pos.start(depth);
      if (depth >= 2) {
        const listNode = $pos.node(depth - 1);
        if (listNode.type.name === 'ordered_list') {
          return { targetPos: innerPos, currentTypeId: 'orderedList' };
        }
      }

      if (node.attrs.checked != null) {
        return { targetPos: innerPos, currentTypeId: 'taskList' };
      }

      return { targetPos: innerPos, currentTypeId: 'bulletList' };
    }
  }

  if (node.type.name === 'paragraph') {
    return { targetPos: blockPos + node.nodeSize - 1, currentTypeId: 'paragraph' };
  }

  return { targetPos: Math.min(blockPos + 1, view.state.doc.nodeSize - 2), currentTypeId: null };
}
