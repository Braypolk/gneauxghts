import { setBlockType, wrapIn } from 'prosemirror-commands';
import {
  Fragment,
  type Node as ProseMirrorNode,
  type NodeType
} from 'prosemirror-model';
import { EditorState, TextSelection, type Selection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { wrapInList } from 'prosemirror-schema-list';
import { liftTarget } from 'prosemirror-transform';

export interface EditorMenuOption {
  id: string;
  label: string;
}

export interface EditorMenuGroup {
  key: string;
  label: string;
  items: readonly EditorMenuOption[];
}

interface ListSelectionRangeInfo {
  listPos: number;
  listDepth: number;
  listNode: ProseMirrorNode;
  startIndex: number;
  endIndex: number;
}

const wikilinkSlashIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M10 9H6.75A3.75 3.75 0 1 0 6.75 16.5H10" />
    <path d="M14 15H17.25A3.75 3.75 0 1 0 17.25 7.5H14" />
    <path d="M8.5 12h7" />
  </svg>
`;

export const baseTextMenuItems = [
  { id: 'paragraph', label: 'Text' },
  { id: 'heading1', label: 'Heading 1' },
  { id: 'heading2', label: 'Heading 2' },
  { id: 'heading3', label: 'Heading 3' },
  { id: 'heading4', label: 'Heading 4' },
  { id: 'heading5', label: 'Heading 5' },
  { id: 'heading6', label: 'Heading 6' },
  { id: 'quote', label: 'Quote' }
] as const satisfies readonly EditorMenuOption[];

export const baseListMenuItems = [
  { id: 'bulletList', label: 'Bullet List' },
  { id: 'orderedList', label: 'Ordered List' },
  { id: 'taskList', label: 'Task List' }
] as const satisfies readonly EditorMenuOption[];

export const baseAdvancedMenuItems = [{ id: 'code', label: 'Code' }] as const satisfies readonly EditorMenuOption[];

export const slashMenuGroups: readonly EditorMenuGroup[] = [
  {
    key: 'text',
    label: 'Text',
    items: [
      ...baseTextMenuItems,
      { id: 'divider', label: 'Divider' },
      { id: 'wikilink', label: 'Wikilink' }
    ]
  },
  {
    key: 'list',
    label: 'List',
    items: baseListMenuItems
  },
  {
    key: 'advanced',
    label: 'Advanced',
    items: baseAdvancedMenuItems
  }
];

export const blockTypeMenuGroups: readonly EditorMenuGroup[] = [
  {
    key: 'text',
    label: 'Text',
    items: baseTextMenuItems
  },
  {
    key: 'list',
    label: 'List',
    items: baseListMenuItems
  },
  {
    key: 'advanced',
    label: 'Advanced',
    items: baseAdvancedMenuItems
  }
];

export const slashMenuOptionIds = new Set(
  slashMenuGroups.flatMap((group) => group.items.map((item) => item.id))
);

export const blockTypeIcons: Record<string, string> = {
  paragraph: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 5.5C5 6.33 5.67 7 6.5 7H10.5V17.5C10.5 18.33 11.17 19 12 19C12.83 19 13.5 18.33 13.5 17.5V7H17.5C18.33 7 19 6.33 19 5.5C19 4.67 18.33 4 17.5 4H6.5C5.67 4 5 4.67 5 5.5Z"/></svg>`,
  heading1: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM12 17H14V7H10V9H12V17Z"/></svg>`,
  heading2: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15H11V13H13C14.1 13 15 12.11 15 11V9C15 7.89 14.1 7 13 7H9V9H13V11H11C9.9 11 9 11.89 9 13V17H15V15Z"/></svg>`,
  heading3: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15V13.5C15 12.67 14.33 12 13.5 12C14.33 12 15 11.33 15 10.5V9C15 7.89 14.1 7 13 7H9V9H13V11H11V13H13V15H9V17H13C14.1 17 15 16.11 15 15Z"/></svg>`,
  heading4: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19.04 3H5.04004C3.94004 3 3.04004 3.9 3.04004 5V19C3.04004 20.1 3.94004 21 5.04004 21H19.04C20.14 21 21.04 20.1 21.04 19V5C21.04 3.9 20.14 3 19.04 3ZM19.04 19H5.04004V5H19.04V19ZM13.04 17H15.04V7H13.04V11H11.04V7H9.04004V13H13.04V17Z"/></svg>`,
  heading5: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15V13C15 11.89 14.1 11 13 11H11V9H15V7H9V13H13V15H9V17H13C14.1 17 15 16.11 15 15Z"/></svg>`,
  heading6: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M11 17H13C14.1 17 15 16.11 15 15V13C15 11.89 14.1 11 13 11H11V9H15V7H11C9.9 7 9 7.89 9 9V15C9 16.11 9.9 17 11 17ZM11 13H13V15H11V13ZM19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19Z"/></svg>`,
  quote: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7.17 17C7.68 17 8.15 16.71 8.37 16.26L9.79 13.42C9.93 13.14 10 12.84 10 12.53V8C10 7.45 9.55 7 9 7H5C4.45 7 4 7.45 4 8V12C4 12.55 4.45 13 5 13H7L5.97 15.06C5.52 15.95 6.17 17 7.17 17ZM17.17 17C17.68 17 18.15 16.71 18.37 16.26L19.79 13.42C19.93 13.14 20 12.84 20 12.53V8C20 7.45 19.55 7 19 7H15C14.45 7 14 7.45 14 8V12C14 12.55 14.45 13 15 13H17L15.97 15.06C15.52 15.95 16.17 17 17.17 17Z"/></svg>`,
  divider: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 11H20V13H4V11Z"/></svg>`,
  bulletList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 10.5C3.17 10.5 2.5 11.17 2.5 12C2.5 12.83 3.17 13.5 4 13.5C4.83 13.5 5.5 12.83 5.5 12C5.5 11.17 4.83 10.5 4 10.5ZM4 4.5C3.17 4.5 2.5 5.17 2.5 6C2.5 6.83 3.17 7.5 4 7.5C4.83 7.5 5.5 6.83 5.5 6C5.5 5.17 4.83 4.5 4 4.5ZM4 16.5C3.17 16.5 2.5 17.18 2.5 18C2.5 18.82 3.18 19.5 4 19.5C4.82 19.5 5.5 18.82 5.5 18C5.5 17.18 4.83 16.5 4 16.5ZM8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19ZM8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13ZM7 6C7 6.55 7.45 7 8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6Z"/></svg>`,
  orderedList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6C7 6.55 7.45 7 8 7ZM20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17ZM20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11ZM4.5 16H2.5C2.22 16 2 16.22 2 16.5C2 16.78 2.22 17 2.5 17H4V17.5H3.5C3.22 17.5 3 17.72 3 18C3 18.28 3.22 18.5 3.5 18.5H4V19H2.5C2.22 19 2 19.22 2 19.5C2 19.78 2.22 20 2.5 20H4.5C4.78 20 5 19.78 5 19.5V16.5C5 16.22 4.78 16 4.5 16ZM2.5 5H3V7.5C3 7.78 3.22 8 3.5 8C3.78 8 4 7.78 4 7.5V4.5C4 4.22 3.78 4 3.5 4H2.5C2.22 4 2 4.22 2 4.5C2 4.78 2.22 5 2.5 5ZM4.5 10H2.5C2.22 10 2 10.22 2 10.5C2 10.78 2.22 11 2.5 11H3.8L2.12 12.96C2.04 13.05 2 13.17 2 13.28V13.5C2 13.78 2.22 14 2.5 14H4.5C4.78 14 5 13.78 5 13.5C5 13.22 4.78 13 4.5 13H3.2L4.88 11.04C4.96 10.95 5 10.83 5 10.72V10.5C5 10.22 4.78 10 4.5 10Z"/></svg>`,
  taskList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5.67 16.34L9.39 12.62C9.54 12.47 9.72 12.39 9.92 12.4C10.12 12.4 10.3 12.48 10.45 12.63C10.58 12.78 10.65 12.96 10.65 13.16C10.65 13.36 10.58 13.54 10.45 13.69L6.33 17.82C6.15 18 5.94 18.09 5.69 18.09C5.45 18.09 5.24 18 5.06 17.82L3.02 15.78C2.88 15.64 2.81 15.46 2.81 15.25C2.82 15.04 2.89 14.87 3.03 14.73C3.17 14.59 3.34 14.52 3.55 14.52C3.76 14.52 3.93 14.59 4.07 14.73L5.67 16.34ZM5.67 8.72L9.39 5C9.54 4.85 9.72 4.78 9.92 4.78C10.12 4.78 10.3 4.86 10.45 5.02C10.58 5.17 10.65 5.34 10.65 5.54C10.65 5.75 10.58 5.92 10.45 6.07L6.33 10.2C6.15 10.39 5.94 10.48 5.69 10.48C5.45 10.48 5.24 10.39 5.06 10.2L3.02 8.16C2.88 8.02 2.81 7.85 2.81 7.64C2.82 7.43 2.89 7.25 3.03 7.12C3.17 6.98 3.34 6.91 3.55 6.91C3.76 6.91 3.93 6.98 4.07 7.12L5.67 8.72ZM13.76 16.56C13.55 16.56 13.37 16.49 13.23 16.34C13.08 16.2 13.01 16.02 13.01 15.81C13.01 15.6 13.08 15.42 13.23 15.27C13.37 15.13 13.55 15.06 13.76 15.06H20.76C20.97 15.06 21.15 15.13 21.29 15.27C21.44 15.42 21.51 15.6 21.51 15.81C21.51 16.02 21.44 16.2 21.29 16.34C21.15 16.49 20.97 16.56 20.76 16.56H13.76ZM13.76 8.94C13.55 8.94 13.37 8.87 13.23 8.73C13.08 8.58 13.01 8.41 13.01 8.19C13.01 7.98 13.08 7.8 13.23 7.66C13.37 7.51 13.55 7.44 13.76 7.44H20.76C20.97 7.44 21.15 7.51 21.29 7.66C21.44 7.8 21.51 7.98 21.51 8.19C21.51 8.41 21.44 8.58 21.29 8.73C21.15 8.87 20.97 8.94 20.76 8.94H13.76Z"/></svg>`,
  code: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6ZM14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6Z"/></svg>`,
  wikilink: wikilinkSlashIcon
};

function readBooleanAttr(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return fallback;
}

function readNullableBooleanAttr(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return null;
}

function readNumberAttr(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function createTaskListTransaction(
  state: EditorState,
  {
    checked = false,
    requireSelectionAtEnd = false,
    scrollIntoView = false
  }: {
    checked?: boolean;
    requireSelectionAtEnd?: boolean;
    scrollIntoView?: boolean;
  } = {}
): Transaction | null {
  const { selection, schema } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }

  const { $from } = selection;
  if (requireSelectionAtEnd && $from.parentOffset !== $from.parent.content.size) {
    return null;
  }

  const parent = $from.parent;
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') {
    return null;
  }

  const blockPos = $from.before();
  const paragraph = schema.nodes.paragraph.create();
  const listItem = schema.nodes.list_item.create({ checked }, paragraph);
  const taskList = schema.nodes.bullet_list.create({ bullet: '-', tight: false }, listItem);
  const transaction = state.tr.replaceWith(blockPos, blockPos + parent.nodeSize, taskList);
  transaction.setSelection(TextSelection.create(transaction.doc, blockPos + 3));

  return scrollIntoView ? transaction.scrollIntoView() : transaction;
}

function getNearestListAncestor($pos: Selection['$from']) {
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      return {
        listDepth: depth,
        listNode: node,
        listPos: $pos.before(depth)
      };
    }
  }

  return null;
}

function resolveListSelectionRange(view: EditorView): ListSelectionRangeInfo | null {
  const { doc, selection } = view.state;
  const rangeStart = selection.from;
  const rangeEnd = selection.empty ? selection.to : Math.max(selection.from, selection.to - 1);
  const startResolved = doc.resolve(rangeStart);
  const endResolved = doc.resolve(rangeEnd);
  const startInfo = getNearestListAncestor(startResolved);
  const endInfo = getNearestListAncestor(endResolved);

  if (!startInfo || !endInfo) {
    return null;
  }

  if (startInfo.listPos !== endInfo.listPos || startInfo.listDepth !== endInfo.listDepth) {
    return null;
  }

  const startIndex = startResolved.index(startInfo.listDepth);
  const endIndex = endResolved.index(endInfo.listDepth);

  if (
    startIndex < 0 ||
    endIndex < 0 ||
    startIndex >= startInfo.listNode.childCount ||
    endIndex >= startInfo.listNode.childCount
  ) {
    return null;
  }

  return {
    ...startInfo,
    startIndex: Math.min(startIndex, endIndex),
    endIndex: Math.max(startIndex, endIndex)
  };
}

function liftSelectionOutOfBlockquote(view: EditorView) {
  const { $from, $to } = view.state.selection;
  const range = $from.blockRange($to, (node) => node.type.name === 'blockquote');
  if (!range) return false;

  const target = liftTarget(range);
  if (target == null) return false;

  view.dispatch(view.state.tr.lift(range, target).scrollIntoView());
  return true;
}

function ensureParagraphSelection(
  view: EditorView,
  paragraphType: NodeType
) {
  if (view.state.selection.$from.parent.type.name === 'paragraph') {
    return true;
  }

  return setBlockType(paragraphType)(view.state, view.dispatch);
}

function normalizeSelectionForList(
  view: EditorView,
  paragraphType: NodeType
) {
  let lifted = false;
  while (liftSelectionOutOfBlockquote(view)) {
    lifted = true;
  }

  const parentTypeName = view.state.selection.$from.parent.type.name;
  if (parentTypeName !== 'paragraph') {
    return ensureParagraphSelection(view, paragraphType) || lifted;
  }

  return lifted;
}

function buildListAttrsForTarget(
  listNode: ProseMirrorNode,
  targetId: 'bulletList' | 'orderedList' | 'taskList',
  orderedStart = readNumberAttr(listNode.attrs.order, 1)
) {
  const spread = readBooleanAttr(listNode.attrs.spread, false);

  if (targetId === 'orderedList') {
    return {
      order: orderedStart,
      spread
    };
  }

  return { spread };
}

function buildListAttrsForExistingType(listNode: ProseMirrorNode, orderedStart: number) {
  const spread = readBooleanAttr(listNode.attrs.spread, false);

  if (listNode.type.name === 'ordered_list') {
    return {
      order: orderedStart,
      spread
    };
  }

  return { spread };
}

function buildListItemAttrsForTarget(
  itemNode: ProseMirrorNode,
  targetId: 'bulletList' | 'orderedList' | 'taskList',
  itemIndex: number,
  orderedStart: number
) {
  const spread = readBooleanAttr(itemNode.attrs.spread, true);
  const checked = readNullableBooleanAttr(itemNode.attrs.checked);

  if (targetId === 'orderedList') {
    return {
      ...itemNode.attrs,
      label: `${orderedStart + itemIndex}.`,
      listType: 'ordered',
      spread,
      checked: null
    };
  }

  return {
    ...itemNode.attrs,
    label: '•',
    listType: 'bullet',
    spread,
    checked: targetId === 'taskList' ? checked ?? false : null
  };
}

function isListSelectionAlreadyTargeted(
  listNode: ProseMirrorNode,
  selectedItems: readonly ProseMirrorNode[],
  targetId: 'bulletList' | 'orderedList' | 'taskList'
) {
  if (targetId === 'orderedList') {
    return listNode.type.name === 'ordered_list';
  }

  if (listNode.type.name !== 'bullet_list') {
    return false;
  }

  if (targetId === 'bulletList') {
    return selectedItems.every((item) => readNullableBooleanAttr(item.attrs.checked) == null);
  }

  return selectedItems.every((item) => readNullableBooleanAttr(item.attrs.checked) != null);
}

function convertCurrentList(
  view: EditorView,
  bulletListType: NodeType,
  orderedListType: NodeType,
  targetId: 'bulletList' | 'orderedList' | 'taskList'
) {
  const selectionRange = resolveListSelectionRange(view);
  if (!selectionRange) {
    return false;
  }

  const { listNode, listPos, startIndex, endIndex } = selectionRange;
  const targetListType = targetId === 'orderedList' ? orderedListType : bulletListType;
  const originalOrderedStart = readNumberAttr(listNode.attrs.order, 1);
  const targetOrderedStart =
    listNode.type.name === 'ordered_list' ? originalOrderedStart + startIndex : 1;
  const transaction = view.state.tr;

  const beforeItems: ProseMirrorNode[] = [];
  const selectedItems: ProseMirrorNode[] = [];
  const afterItems: ProseMirrorNode[] = [];

  for (let index = 0; index < listNode.childCount; index += 1) {
    const child = listNode.child(index);
    if (index < startIndex) {
      beforeItems.push(child);
      continue;
    }

    if (index > endIndex) {
      afterItems.push(child);
      continue;
    }

    selectedItems.push(child);
  }

  if (
    selectedItems.length === 0 ||
    isListSelectionAlreadyTargeted(listNode, selectedItems, targetId)
  ) {
    return true;
  }

  const replacementNodes: ProseMirrorNode[] = [];

  if (beforeItems.length > 0) {
    replacementNodes.push(
      listNode.type.create(buildListAttrsForExistingType(listNode, originalOrderedStart), beforeItems)
    );
  }

  replacementNodes.push(
    targetListType.create(
      buildListAttrsForTarget(listNode, targetId, targetOrderedStart),
      selectedItems.map((item, itemIndex) =>
        item.type.create(
          buildListItemAttrsForTarget(item, targetId, itemIndex, targetOrderedStart),
          item.content,
          item.marks
        )
      )
    )
  );

  if (afterItems.length > 0) {
    const afterOrderedStart =
      listNode.type.name === 'ordered_list' ? originalOrderedStart + endIndex + 1 : 1;
    replacementNodes.push(
      listNode.type.create(buildListAttrsForExistingType(listNode, afterOrderedStart), afterItems)
    );
  }

  transaction.replaceWith(
    listPos,
    listPos + listNode.nodeSize,
    Fragment.fromArray(replacementNodes)
  );

  const mappedAnchor = transaction.mapping.map(view.state.selection.anchor);
  const mappedHead = transaction.mapping.map(view.state.selection.head);
  transaction.setSelection(TextSelection.create(transaction.doc, mappedAnchor, mappedHead));

  if (transaction.docChanged) {
    view.dispatch(transaction.scrollIntoView());
  }

  return true;
}

function wrapSelectionInList(
  view: EditorView,
  bulletListType: NodeType,
  orderedListType: NodeType,
  targetId: 'bulletList' | 'orderedList' | 'taskList'
) {
  const listType = targetId === 'orderedList' ? orderedListType : bulletListType;
  const wrapped = wrapInList(listType)(view.state, view.dispatch);

  if (!wrapped) {
    return false;
  }

  if (targetId === 'taskList') {
    return convertCurrentList(view, bulletListType, orderedListType, 'taskList');
  }

  return true;
}

function insertWikilinkAtSelection(view: EditorView) {
  const { $from } = view.state.selection;
  const from = $from.start();
  const to = $from.end();
  const transaction = view.state.tr.insertText('[[]]', from, to);
  transaction.setSelection(TextSelection.create(transaction.doc, from + 2));
  view.dispatch(transaction);
  view.focus();
}

export function applyBlockTypeSelection(
  view: EditorView,
  id: string
) {
  const { schema } = view.state;

  if (id === 'paragraph') {
    setBlockType(schema.nodes.paragraph)(view.state, view.dispatch);
    return;
  }

  if (id === 'bulletList' || id === 'orderedList' || id === 'taskList') {
    const bulletListType = schema.nodes.bullet_list;
    const orderedListType = schema.nodes.ordered_list;
    const paragraphType = schema.nodes.paragraph;

    if (convertCurrentList(view, bulletListType, orderedListType, id)) {
      return;
    }

    normalizeSelectionForList(view, paragraphType);
    wrapSelectionInList(view, bulletListType, orderedListType, id);
    return;
  }

  if (id.startsWith('heading')) {
    const level = parseInt(id.replace('heading', ''), 10);
    setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch);
    return;
  }

  if (id === 'quote') {
    wrapIn(schema.nodes.blockquote)(view.state, view.dispatch);
    return;
  }

  if (id === 'code') {
    setBlockType(schema.nodes.code_block)(view.state, view.dispatch);
    return;
  }

  if (id === 'divider') {
    const transaction = view.state.tr.replaceSelectionWith(
      schema.nodes.horizontal_rule.create()
    );
    view.dispatch(transaction.scrollIntoView());
    return;
  }

  if (id === 'wikilink') {
    insertWikilinkAtSelection(view);
  }
}
