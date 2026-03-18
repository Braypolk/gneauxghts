import type { Crepe } from '@milkdown/crepe';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import {
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  headingSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  wrapInBlockTypeCommand
} from '@milkdown/kit/preset/commonmark';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { wrapInList } from '@milkdown/kit/prose/schema-list';
import { TextSelection } from '@milkdown/kit/prose/state';
import { liftTarget } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { replaceAll } from '@milkdown/kit/utils';
import { tick } from 'svelte';
import { notepadWikilinks, type ActiveWikilink } from './notepadWikilinks';
import { setupNotepadSlashMenuPortal } from './notepadSlashMenuPortal';

interface CreateNotepadEditorOptions {
  editorRoot: HTMLDivElement;
  initialValue: string;
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
  onMarkdownChange: (markdown: string) => void;
}

interface ResetSlashMenuPortalOptions {
  boundsElement: HTMLDivElement | null;
  editorRoot: HTMLDivElement | null;
  portalRoot: HTMLDivElement | null;
  currentCleanup: (() => void) | null;
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

// ── Block type menu ──────────────────────────────────────────────────

const blockTypeIcons: Record<string, string> = {
  paragraph: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 5.5C5 6.33 5.67 7 6.5 7H10.5V17.5C10.5 18.33 11.17 19 12 19C12.83 19 13.5 18.33 13.5 17.5V7H17.5C18.33 7 19 6.33 19 5.5C19 4.67 18.33 4 17.5 4H6.5C5.67 4 5 4.67 5 5.5Z"/></svg>`,
  heading1: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM12 17H14V7H10V9H12V17Z"/></svg>`,
  heading2: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15H11V13H13C14.1 13 15 12.11 15 11V9C15 7.89 14.1 7 13 7H9V9H13V11H11C9.9 11 9 11.89 9 13V17H15V15Z"/></svg>`,
  heading3: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15V13.5C15 12.67 14.33 12 13.5 12C14.33 12 15 11.33 15 10.5V9C15 7.89 14.1 7 13 7H9V9H13V11H11V13H13V15H9V17H13C14.1 17 15 16.11 15 15Z"/></svg>`,
  heading4: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19.04 3H5.04004C3.94004 3 3.04004 3.9 3.04004 5V19C3.04004 20.1 3.94004 21 5.04004 21H19.04C20.14 21 21.04 20.1 21.04 19V5C21.04 3.9 20.14 3 19.04 3ZM19.04 19H5.04004V5H19.04V19ZM13.04 17H15.04V7H13.04V11H11.04V7H9.04004V13H13.04V17Z"/></svg>`,
  heading5: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15V13C15 11.89 14.1 11 13 11H11V9H15V7H9V13H13V15H9V17H13C14.1 17 15 16.11 15 15Z"/></svg>`,
  heading6: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M11 17H13C14.1 17 15 16.11 15 15V13C15 11.89 14.1 11 13 11H11V9H15V7H11C9.9 7 9 7.89 9 9V15C9 16.11 9.9 17 11 17ZM11 13H13V15H11V13ZM19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19Z"/></svg>`,
  quote: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7.17 17C7.68 17 8.15 16.71 8.37 16.26L9.79 13.42C9.93 13.14 10 12.84 10 12.53V8C10 7.45 9.55 7 9 7H5C4.45 7 4 7.45 4 8V12C4 12.55 4.45 13 5 13H7L5.97 15.06C5.52 15.95 6.17 17 7.17 17ZM17.17 17C17.68 17 18.15 16.71 18.37 16.26L19.79 13.42C19.93 13.14 20 12.84 20 12.53V8C20 7.45 19.55 7 19 7H15C14.45 7 14 7.45 14 8V12C14 12.55 14.45 13 15 13H17L15.97 15.06C15.52 15.95 16.17 17 17.17 17Z"/></svg>`,
  bulletList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 10.5C3.17 10.5 2.5 11.17 2.5 12C2.5 12.83 3.17 13.5 4 13.5C4.83 13.5 5.5 12.83 5.5 12C5.5 11.17 4.83 10.5 4 10.5ZM4 4.5C3.17 4.5 2.5 5.17 2.5 6C2.5 6.83 3.17 7.5 4 7.5C4.83 7.5 5.5 6.83 5.5 6C5.5 5.17 4.83 4.5 4 4.5ZM4 16.5C3.17 16.5 2.5 17.18 2.5 18C2.5 18.82 3.18 19.5 4 19.5C4.82 19.5 5.5 18.82 5.5 18C5.5 17.18 4.83 16.5 4 16.5ZM8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19ZM8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13ZM7 6C7 6.55 7.45 7 8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6Z"/></svg>`,
  orderedList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6C7 6.55 7.45 7 8 7ZM20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17ZM20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11ZM4.5 16H2.5C2.22 16 2 16.22 2 16.5C2 16.78 2.22 17 2.5 17H4V17.5H3.5C3.22 17.5 3 17.72 3 18C3 18.28 3.22 18.5 3.5 18.5H4V19H2.5C2.22 19 2 19.22 2 19.5C2 19.78 2.22 20 2.5 20H4.5C4.78 20 5 19.78 5 19.5V16.5C5 16.22 4.78 16 4.5 16ZM2.5 5H3V7.5C3 7.78 3.22 8 3.5 8C3.78 8 4 7.78 4 7.5V4.5C4 4.22 3.78 4 3.5 4H2.5C2.22 4 2 4.22 2 4.5C2 4.78 2.22 5 2.5 5ZM4.5 10H2.5C2.22 10 2 10.22 2 10.5C2 10.78 2.22 11 2.5 11H3.8L2.12 12.96C2.04 13.05 2 13.17 2 13.28V13.5C2 13.78 2.22 14 2.5 14H4.5C4.78 14 5 13.78 5 13.5C5 13.22 4.78 13 4.5 13H3.2L4.88 11.04C4.96 10.95 5 10.83 5 10.72V10.5C5 10.22 4.78 10 4.5 10Z"/></svg>`,
  taskList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5.67 16.34L9.39 12.62C9.54 12.47 9.72 12.39 9.92 12.4C10.12 12.4 10.3 12.48 10.45 12.63C10.58 12.78 10.65 12.96 10.65 13.16C10.65 13.36 10.58 13.54 10.45 13.69L6.33 17.82C6.15 18 5.94 18.09 5.69 18.09C5.45 18.09 5.24 18 5.06 17.82L3.02 15.78C2.88 15.64 2.81 15.46 2.81 15.25C2.82 15.04 2.89 14.87 3.03 14.73C3.17 14.59 3.34 14.52 3.55 14.52C3.76 14.52 3.93 14.59 4.07 14.73L5.67 16.34ZM5.67 8.72L9.39 5C9.54 4.85 9.72 4.78 9.92 4.78C10.12 4.78 10.3 4.86 10.45 5.02C10.58 5.17 10.65 5.34 10.65 5.54C10.65 5.75 10.58 5.92 10.45 6.07L6.33 10.2C6.15 10.39 5.94 10.48 5.69 10.48C5.45 10.48 5.24 10.39 5.06 10.2L3.02 8.16C2.88 8.02 2.81 7.85 2.81 7.64C2.82 7.43 2.89 7.25 3.03 7.12C3.17 6.98 3.34 6.91 3.55 6.91C3.76 6.91 3.93 6.98 4.07 7.12L5.67 8.72ZM13.76 16.56C13.55 16.56 13.37 16.49 13.23 16.34C13.08 16.2 13.01 16.02 13.01 15.81C13.01 15.6 13.08 15.42 13.23 15.27C13.37 15.13 13.55 15.06 13.76 15.06H20.76C20.97 15.06 21.15 15.13 21.29 15.27C21.44 15.42 21.51 15.6 21.51 15.81C21.51 16.02 21.44 16.2 21.29 16.34C21.15 16.49 20.97 16.56 20.76 16.56H13.76ZM13.76 8.94C13.55 8.94 13.37 8.87 13.23 8.73C13.08 8.58 13.01 8.41 13.01 8.19C13.01 7.98 13.08 7.8 13.23 7.66C13.37 7.51 13.55 7.44 13.76 7.44H20.76C20.97 7.44 21.15 7.51 21.29 7.66C21.44 7.8 21.51 7.98 21.51 8.19C21.51 8.41 21.44 8.58 21.29 8.73C21.15 8.87 20.97 8.94 20.76 8.94H13.76Z"/></svg>`,
  code: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6ZM14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6Z"/></svg>`
};

interface BlockTypeMenuOption {
  id: string;
  label: string;
}

interface BlockTypeMenuGroup {
  key: string;
  label: string;
  items: readonly BlockTypeMenuOption[];
}

const blockTypeMenuGroups: readonly BlockTypeMenuGroup[] = [
  {
    key: 'text',
    label: 'Text',
    items: [
      { id: 'paragraph', label: 'Text' },
      { id: 'heading1', label: 'Heading 1' },
      { id: 'heading2', label: 'Heading 2' },
      { id: 'heading3', label: 'Heading 3' },
      { id: 'heading4', label: 'Heading 4' },
      { id: 'heading5', label: 'Heading 5' },
      { id: 'heading6', label: 'Heading 6' },
      { id: 'quote', label: 'Quote' }
    ]
  },
  {
    key: 'list',
    label: 'List',
    items: [
      { id: 'bulletList', label: 'Bullet List' },
      { id: 'orderedList', label: 'Ordered List' },
      { id: 'taskList', label: 'Task List' }
    ]
  },
  {
    key: 'advanced',
    label: 'Advanced',
    items: [{ id: 'code', label: 'Code' }]
  }
];

const blockHandleMenuCleanupByCrepe = new WeakMap<Crepe, () => void>();

function getBlockHandleDragButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;

  const operationItem = target.closest('.operation-item');
  const blockHandle = operationItem?.closest('.milkdown-block-handle');

  if (!(operationItem instanceof HTMLElement) || !(blockHandle instanceof HTMLElement)) return null;

  return operationItem === blockHandle.lastElementChild ? operationItem : null;
}

interface BlockContext {
  targetPos: number;
  currentTypeId: string | null;
}

interface SelectionAncestorInfo {
  listPos: number | null;
  listNode: ProseMirrorNode | null;
}

interface CommandRunner {
  call: (command: unknown, payload?: unknown) => boolean;
}

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

function getSelectionAncestorInfo(view: EditorView): SelectionAncestorInfo {
  const { $from } = view.state.selection;
  let listPos: number | null = null;
  let listNode: ProseMirrorNode | null = null;

  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      listPos = $from.before(depth);
      listNode = node;
      break;
    }
  }

  return { listPos, listNode };
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
  commands: CommandRunner,
  paragraphType: ReturnType<typeof paragraphSchema.type>
) {
  if (view.state.selection.$from.parent.type.name === 'paragraph') {
    return true;
  }

  return commands.call(setBlockTypeCommand.key, { nodeType: paragraphType });
}

function normalizeSelectionForList(
  view: EditorView,
  commands: CommandRunner,
  paragraphType: ReturnType<typeof paragraphSchema.type>
) {
  let lifted = false;
  while (liftSelectionOutOfBlockquote(view)) {
    lifted = true;
  }

  const parentTypeName = view.state.selection.$from.parent.type.name;
  if (parentTypeName !== 'paragraph') {
    return ensureParagraphSelection(view, commands, paragraphType) || lifted;
  }

  return lifted;
}

function buildListAttrsForTarget(listNode: ProseMirrorNode, targetId: 'bulletList' | 'orderedList' | 'taskList') {
  const spread = readBooleanAttr(listNode.attrs.spread, false);

  if (targetId === 'orderedList') {
    return {
      order: readNumberAttr(listNode.attrs.order, 1),
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

function convertCurrentList(
  view: EditorView,
  bulletListType: ReturnType<typeof bulletListSchema.type>,
  orderedListType: ReturnType<typeof orderedListSchema.type>,
  targetId: 'bulletList' | 'orderedList' | 'taskList'
) {
  const { listNode, listPos } = getSelectionAncestorInfo(view);
  if (!listNode || listPos === null) {
    return false;
  }

  const targetListType = targetId === 'orderedList' ? orderedListType : bulletListType;
  const orderedStart = readNumberAttr(listNode.attrs.order, 1);
  const transaction = view.state.tr;

  transaction.setNodeMarkup(listPos, targetListType, buildListAttrsForTarget(listNode, targetId));

  let itemPos = listPos + 1;
  let itemIndex = 0;
  listNode.forEach((child) => {
    if (child.type.name === 'list_item') {
      transaction.setNodeMarkup(
        itemPos,
        child.type,
        buildListItemAttrsForTarget(child, targetId, itemIndex, orderedStart)
      );
      itemIndex += 1;
    }
    itemPos += child.nodeSize;
  });

  if (transaction.docChanged) {
    view.dispatch(transaction.scrollIntoView());
  }

  return true;
}

function wrapSelectionInList(
  view: EditorView,
  bulletListType: ReturnType<typeof bulletListSchema.type>,
  orderedListType: ReturnType<typeof orderedListSchema.type>,
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

function resolveBlockContext(
  crepe: Crepe,
  editorRoot: HTMLDivElement,
  handleButton: HTMLElement
): BlockContext | null {
  const rect = handleButton.getBoundingClientRect();
  const probeY = Math.round(
    Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2))
  );

  let hitElement: HTMLElement | null = null;
  for (const offset of [32, 64, 96, 128]) {
    const probeX = Math.round(Math.min(window.innerWidth - 1, Math.max(0, rect.right + offset)));
    const candidate = document.elementFromPoint(probeX, probeY);
    if (candidate instanceof HTMLElement && editorRoot.contains(candidate)) {
      hitElement = candidate;
      break;
    }
  }

  if (!hitElement) return null;

  let result: BlockContext | null = null;
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    try {
      const pos = view.posAtDOM(hitElement!, 0);
      const $pos = view.state.doc.resolve(pos);

      for (let depth = $pos.depth; depth >= 1; depth--) {
        const node = $pos.node(depth);
        const name = node.type.name;

        if (name === 'heading') {
          result = { targetPos: $pos.end(depth), currentTypeId: `heading${node.attrs.level}` };
          return;
        }
        if (name === 'code_block') {
          result = { targetPos: $pos.start(depth) + 1, currentTypeId: 'code' };
          return;
        }
        if (name === 'blockquote') {
          const innerPos = $pos.parent.isTextblock ? $pos.end() : $pos.start(depth) + 1;
          result = { targetPos: innerPos, currentTypeId: 'quote' };
          return;
        }
        if (name === 'list_item') {
          const innerPos = $pos.parent.isTextblock ? $pos.end() : $pos.start(depth) + 1;
          if (depth >= 2) {
            const listNode = $pos.node(depth - 1);
            if (listNode.type.name === 'ordered_list') {
              result = { targetPos: innerPos, currentTypeId: 'orderedList' };
              return;
            }
            if (node.attrs.checked != null) {
              result = { targetPos: innerPos, currentTypeId: 'taskList' };
              return;
            }
            result = { targetPos: innerPos, currentTypeId: 'bulletList' };
            return;
          }
        }
        if (name === 'paragraph') {
          result = { targetPos: $pos.end(depth), currentTypeId: 'paragraph' };
          return;
        }
      }

      if ($pos.parent.isTextblock) {
        result = { targetPos: $pos.end(), currentTypeId: null };
      }
    } catch {
      result = null;
    }
  });

  return result;
}

function applyBlockTypeMenuSelection(crepe: Crepe, targetPos: number, option: BlockTypeMenuOption) {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const commands = ctx.get(commandsCtx);
    const maxPos = Math.max(1, view.state.doc.nodeSize - 2);
    const selectionPos = Math.max(1, Math.min(targetPos, maxPos));
    const transaction = view.state.tr
      .setSelection(TextSelection.near(view.state.doc.resolve(selectionPos)))
      .scrollIntoView();

    view.dispatch(transaction);
    view.focus();

    const id = option.id;
    if (id === 'paragraph') {
      commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) });
    } else if (id === 'bulletList' || id === 'orderedList' || id === 'taskList') {
      const bulletListType = bulletListSchema.type(ctx);
      const orderedListType = orderedListSchema.type(ctx);
      const paragraphType = paragraphSchema.type(ctx);

      if (convertCurrentList(view, bulletListType, orderedListType, id)) {
        return;
      }

      normalizeSelectionForList(view, commands, paragraphType);
      wrapSelectionInList(view, bulletListType, orderedListType, id);
    } else if (id.startsWith('heading')) {
      const level = parseInt(id.replace('heading', ''), 10);
      commands.call(setBlockTypeCommand.key, {
        nodeType: headingSchema.type(ctx),
        attrs: { level }
      });
    } else if (id === 'quote') {
      commands.call(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) });
    } else if (id === 'code') {
      commands.call(setBlockTypeCommand.key, { nodeType: codeBlockSchema.type(ctx) });
    }
  });
}

function positionBlockTypeMenu(menuRoot: HTMLDivElement, anchorRect: DOMRect) {
  menuRoot.dataset.open = 'true';
  menuRoot.style.visibility = 'hidden';
  menuRoot.style.left = '0px';
  menuRoot.style.top = '0px';

  requestAnimationFrame(() => {
    if (menuRoot.dataset.open !== 'true') return;

    const viewportPadding = 12;
    const menuRect = menuRoot.getBoundingClientRect();
    const nextLeft = Math.min(
      window.innerWidth - menuRect.width - viewportPadding,
      Math.max(viewportPadding, anchorRect.right + 12)
    );
    const nextTop = Math.min(
      window.innerHeight - menuRect.height - viewportPadding,
      Math.max(viewportPadding, anchorRect.top + anchorRect.height / 2 - menuRect.height / 2)
    );

    menuRoot.style.left = `${Math.round(nextLeft)}px`;
    menuRoot.style.top = `${Math.round(nextTop)}px`;
    menuRoot.style.visibility = 'visible';
  });
}

function setupBlockHandleTypeMenu(crepe: Crepe, editorRoot: HTMLDivElement) {
  const documentRoot = editorRoot.ownerDocument;
  const menuRoot = documentRoot.createElement('div');
  menuRoot.className = 'notepad-block-type-menu';
  menuRoot.dataset.open = 'false';

  const buttonsById = new Map<string, HTMLButtonElement>();
  let activeTargetPos: number | null = null;

  const closeMenu = () => {
    activeTargetPos = null;
    menuRoot.dataset.open = 'false';
    menuRoot.style.removeProperty('left');
    menuRoot.style.removeProperty('top');
    menuRoot.style.removeProperty('visibility');
  };

  // Tab navigation
  const tabNav = documentRoot.createElement('nav');
  tabNav.className = 'notepad-block-type-menu-tabs';
  const tabList = documentRoot.createElement('ul');
  const tabsByKey = new Map<string, HTMLLIElement>();

  const selectTab = (key: string) => {
    for (const [k, tab] of tabsByKey) {
      tab.classList.toggle('selected', k === key);
    }
    const targetGroup = menuGroups.querySelector(`[data-group="${key}"]`);
    if (targetGroup) {
      targetGroup.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  for (const group of blockTypeMenuGroups) {
    const tab = documentRoot.createElement('li');
    tab.textContent = group.label;
    tab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      selectTab(group.key);
    });
    tabsByKey.set(group.key, tab);
    tabList.appendChild(tab);
  }

  tabNav.appendChild(tabList);
  menuRoot.appendChild(tabNav);

  // Menu groups
  const menuGroups = documentRoot.createElement('div');
  menuGroups.className = 'notepad-block-type-menu-groups';
  const groupElementsByKey = new Map<string, HTMLDivElement>();

  for (const group of blockTypeMenuGroups) {
    const groupEl = documentRoot.createElement('div');
    groupEl.className = 'notepad-block-type-menu-group';
    groupEl.dataset.group = group.key;

    const heading = documentRoot.createElement('h6');
    heading.textContent = group.label;
    groupEl.appendChild(heading);

    for (const option of group.items) {
      const button = documentRoot.createElement('button');
      button.type = 'button';
      button.className = 'notepad-block-type-menu-item';
      button.dataset.option = option.id;
      button.innerHTML = `${blockTypeIcons[option.id] ?? ''}<span>${option.label}</span>`;
      button.addEventListener('click', () => {
        if (activeTargetPos === null) return;
        applyBlockTypeMenuSelection(crepe, activeTargetPos, option);
        closeMenu();
      });

      buttonsById.set(option.id, button);
      groupEl.appendChild(button);
    }

    groupElementsByKey.set(group.key, groupEl);
    menuGroups.appendChild(groupEl);
  }

  // Sync tab selection on scroll
  const updateActiveTab = () => {
    const scrollTop = menuGroups.scrollTop;
    let activeKey = blockTypeMenuGroups[0]?.key;
    for (const [key, el] of groupElementsByKey) {
      if (el.offsetTop - menuGroups.offsetTop <= scrollTop + 8) {
        activeKey = key;
      }
    }
    if (activeKey) {
      for (const [k, tab] of tabsByKey) {
        tab.classList.toggle('selected', k === activeKey);
      }
    }
  };
  menuGroups.addEventListener('scroll', updateActiveTab);

  menuRoot.appendChild(menuGroups);

  documentRoot.body.appendChild(menuRoot);

  let pointerState: {
    pointerId: number;
    startX: number;
    startY: number;
    handleButton: HTMLElement;
    moved: boolean;
  } | null = null;

  const onTrackedPointerDown = (event: PointerEvent) => {
    const handleButton = getBlockHandleDragButton(event.target);
    if (!handleButton) return;

    pointerState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      handleButton,
      moved: false
    };
  };

  const onWindowPointerMove = (event: PointerEvent) => {
    if (!pointerState || event.pointerId !== pointerState.pointerId) return;

    if (Math.hypot(event.clientX - pointerState.startX, event.clientY - pointerState.startY) > 6) {
      pointerState.moved = true;
    }
  };

  const onWindowPointerUp = (event: PointerEvent) => {
    if (!pointerState || event.pointerId !== pointerState.pointerId) return;

    const captured = pointerState;
    pointerState = null;

    if (captured.moved || !captured.handleButton.isConnected) return;

    event.preventDefault();
    event.stopPropagation();

    const context = resolveBlockContext(crepe, editorRoot, captured.handleButton);
    if (!context) {
      closeMenu();
      return;
    }

    activeTargetPos = context.targetPos;
    let activeGroupKey = blockTypeMenuGroups[0]?.key;
    for (const [optionId, button] of buttonsById) {
      const isActive = context.currentTypeId === optionId;
      button.dataset.active = isActive ? 'true' : 'false';
      if (isActive) {
        for (const group of blockTypeMenuGroups) {
          if (group.items.some((item) => item.id === optionId)) {
            activeGroupKey = group.key;
            break;
          }
        }
      }
    }

    for (const [k, tab] of tabsByKey) {
      tab.classList.toggle('selected', k === activeGroupKey);
    }
    menuGroups.scrollTop = 0;

    positionBlockTypeMenu(menuRoot, captured.handleButton.getBoundingClientRect());
  };

  const onWindowPointerCancel = (event: PointerEvent) => {
    if (pointerState && event.pointerId === pointerState.pointerId) {
      pointerState = null;
    }
  };

  const onDocumentPointerDown = (event: PointerEvent) => {
    if (menuRoot.dataset.open !== 'true') return;

    const target = event.target;
    if (!(target instanceof Node)) {
      closeMenu();
      return;
    }

    if (menuRoot.contains(target) || getBlockHandleDragButton(target)) return;

    closeMenu();
  };

  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (menuRoot.dataset.open === 'true' && event.key === 'Escape') {
      closeMenu();
    }
  };

  const onWindowResize = () => {
    if (menuRoot.dataset.open === 'true') closeMenu();
  };

  editorRoot.addEventListener('pointerdown', onTrackedPointerDown, true);
  window.addEventListener('pointermove', onWindowPointerMove, true);
  window.addEventListener('pointerup', onWindowPointerUp, true);
  window.addEventListener('pointercancel', onWindowPointerCancel, true);
  documentRoot.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('keydown', onWindowKeyDown, true);
  window.addEventListener('resize', onWindowResize);

  return () => {
    closeMenu();
    editorRoot.removeEventListener('pointerdown', onTrackedPointerDown, true);
    window.removeEventListener('pointermove', onWindowPointerMove, true);
    window.removeEventListener('pointerup', onWindowPointerUp, true);
    window.removeEventListener('pointercancel', onWindowPointerCancel, true);
    documentRoot.removeEventListener('pointerdown', onDocumentPointerDown, true);
    window.removeEventListener('keydown', onWindowKeyDown, true);
    window.removeEventListener('resize', onWindowResize);
    menuRoot.remove();
  };
}

// ── Editor lifecycle ─────────────────────────────────────────────────

export async function prepareNotepadEditor(editorRoot: HTMLDivElement | null) {
  if (!editorRoot) return false;
  await tick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return !!editorRoot;
}

export async function createNotepadEditor({
  editorRoot,
  initialValue,
  onOpenLink,
  onActiveWikilinkChange,
  onMarkdownChange
}: CreateNotepadEditorOptions) {
  const { Crepe } = await import('@milkdown/crepe');

  const crepe = new Crepe({
    root: editorRoot,
    defaultValue: initialValue,
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: 'Start writing',
        mode: 'doc'
      },
      [Crepe.Feature.BlockEdit]: {
        buildMenu: (builder) => {
          builder.getGroup('text').addItem('wikilink', {
            label: 'Wikilink',
            icon: wikilinkSlashIcon,
            onRun: (ctx) => {
              const view = ctx.get(editorViewCtx);
              const selectionFrom = view.state.selection.$from;
              const from = selectionFrom.start();
              const to = selectionFrom.end();
              const transaction = view.state.tr.insertText('[[]]', from, to);
              transaction.setSelection(TextSelection.create(transaction.doc, from + 2));
              view.dispatch(transaction);
              view.focus();
            }
          });
        }
      }
    }
  });

  crepe.addFeature(notepadWikilinks, {
    onOpenLink,
    onActiveWikilinkChange
  });

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      onMarkdownChange(markdown);
    });
  });

  await crepe.create();

  const menuCleanup = setupBlockHandleTypeMenu(crepe, editorRoot);
  blockHandleMenuCleanupByCrepe.set(crepe, menuCleanup);

  return crepe;
}

export async function destroyNotepadEditor(crepe: Crepe | null) {
  if (!crepe) return null;

  const menuCleanup = blockHandleMenuCleanupByCrepe.get(crepe);
  if (menuCleanup) {
    menuCleanup();
    blockHandleMenuCleanupByCrepe.delete(crepe);
  }

  await crepe.destroy();
  return null;
}

export function replaceNotepadEditorContent(crepe: Crepe | null, markdown: string) {
  if (!crepe) {
    return false;
  }

  crepe.editor.action(replaceAll(markdown, false));
  return true;
}

export function resetNotepadSlashMenuPortal({
  boundsElement,
  editorRoot,
  portalRoot,
  currentCleanup
}: ResetSlashMenuPortalOptions) {
  if (currentCleanup) {
    currentCleanup();
  }

  if (!boundsElement || !editorRoot || !portalRoot) {
    return null;
  }

  // Crepe mounts the slash menu inside the clipped editor tree, so we reparent and clamp it here.
  return setupNotepadSlashMenuPortal({
    boundsElement,
    editorRoot,
    portalRoot
  });
}

export function insertWikilinkSuggestion(
  crepe: Crepe | null,
  activeWikilink: ActiveWikilink | null,
  suggestionValue: string
) {
  if (!crepe || !activeWikilink) {
    return false;
  }

  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const transaction = view.state.tr.insertText(
      suggestionValue,
      activeWikilink.targetFrom,
      activeWikilink.targetTo
    );
    const cursorPosition = activeWikilink.targetFrom + suggestionValue.length;
    transaction.setSelection(TextSelection.create(transaction.doc, cursorPosition));
    view.dispatch(transaction);
    view.focus();
  });

  return true;
}
