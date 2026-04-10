import {
  baseKeymap,
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  newlineInCode,
  splitBlockKeepMarks
} from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection
} from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { liftListItem, sinkListItem, splitListItemKeepMarks } from 'prosemirror-schema-list';
import { tableEditing } from 'prosemirror-tables';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { tick } from 'svelte';
import { createTaskListTransaction } from '$lib/features/notepad/editor/blockTypes';
import type { CursorPosition } from '$lib/features/notepad/editor/cursorState';
import { getEditorProseSurface } from '$lib/features/notepad/editor/editorDom';
import { setupBlockHandleTypeMenu } from '$lib/features/notepad/editor/blockTypeMenu';
import {
  findAncestorNode,
  isDocEmpty,
  isInCodeContext,
  isInList
} from '$lib/features/notepad/editor/editorSelection';
import { parseMarkdown, serializeMarkdown } from '$lib/features/notepad/editor/markdown';
import { notepadSchema } from '$lib/features/notepad/editor/schema';
import { createSlashMenuPlugin, type SlashMenuAPI } from '$lib/features/notepad/editor/slashMenu';
import { setupSlashMenuPortal } from '$lib/features/notepad/editor/slashMenuPortal';
import { createImageEmbedsPlugin } from '$lib/features/notepad/images/imageEmbeds';
import type { ImagesConfig } from '$lib/features/notepad/images/imageConfig';
import { createImagePastePlugin } from '$lib/features/notepad/images/imagePaste';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import { createWikilinksPlugin, type ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';

interface CreateEditorOptions {
  assetRootPath: string | null;
  editorRoot: HTMLDivElement;
  initialValue: string;
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
  onMarkdownChange: (markdown: string) => void;
  onTaskListToggle: () => void;
  onStorePastedImage: (file: File) => Promise<StoredImageAsset>;
}

interface ResetSlashMenuPortalOptions {
  boundsElement: HTMLDivElement | null;
  editorRoot: HTMLDivElement | null;
  portalRoot: HTMLDivElement | null;
  currentCleanup: (() => void) | null;
}

interface ReplaceEditorContentOptions {
  flushHistory?: boolean;
}

interface ReplaceEditorStateOptions {
  focus?: boolean;
  scrollSelectionIntoView?: boolean;
}

export interface EditorController {
  view: EditorView;
  plugins: Plugin[];
  slashMenuApi: SlashMenuAPI;
}

const addIcon = `
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
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
`;

const dragHandleIcon = `
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
    <circle cx="7.25" cy="5.9" r="1.4" />
    <circle cx="7.25" cy="12" r="1.4" />
    <circle cx="7.25" cy="18.1" r="1.4" />
    <circle cx="16.75" cy="5.9" r="1.4" />
    <circle cx="16.75" cy="12" r="1.4" />
    <circle cx="16.75" cy="18.1" r="1.4" />
  </svg>
`;

interface PlaceholderConfig {
  text: string;
  mode: 'doc' | 'block';
}

function createPlaceholderDecoration(
  state: EditorState,
  placeholderText: string
): Decoration | null {
  const { selection } = state;
  if (!selection.empty) return null;

  const $pos = selection.$anchor;
  const node = $pos.parent;
  if (node.content.size > 0) return null;

  const inTable = findAncestorNode($pos, (candidate) => candidate.type.name === 'table');
  if (inTable) return null;

  const before = $pos.before();
  return Decoration.node(before, before + node.nodeSize, {
    class: 'crepe-placeholder',
    'data-placeholder': placeholderText
  });
}

function createPlaceholderPlugin(config: PlaceholderConfig) {
  return new Plugin({
    key: new PluginKey('NOTEPAD_PLACEHOLDER'),
    props: {
      decorations: (state) => {
        if (config.mode === 'doc' && !isDocEmpty(state.doc)) {
          return null;
        }

        if (isInCodeContext(state.selection) || isInList(state.selection)) {
          return null;
        }

        const decoration = createPlaceholderDecoration(state, config.text);
        if (!decoration) {
          return null;
        }

        return DecorationSet.create(state.doc, [decoration]);
      }
    }
  });
}

function createTaskListInteractionPlugin(onTaskListToggle: () => void) {
  return new Plugin({
    key: new PluginKey('NOTEPAD_TASK_LIST_INTERACTIONS'),
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!(event instanceof MouseEvent) || event.button !== 0) {
            return false;
          }

          const target = event.target;
          const listItem =
            target instanceof Element
              ? target.closest<HTMLElement>('li[data-checked]')
              : null;
          if (!listItem) {
            return false;
          }

          const rect = listItem.getBoundingClientRect();
          const withinCheckboxBounds =
            event.clientX >= rect.left - 4 &&
            event.clientX <= rect.left + 24 &&
            event.clientY >= rect.top &&
            event.clientY <= rect.top + 28;

          if (!withinCheckboxBounds) {
            return false;
          }

          try {
            const pos = view.posAtDOM(listItem, 0);
            const $pos = view.state.doc.resolve(pos);
            const listItemParent = findAncestorNode($pos, (node) => node.type.name === 'list_item');
            if (!listItemParent) {
              return false;
            }
            const listItemPos = listItemParent.pos;

            const currentChecked = listItemParent.node.attrs.checked;
            if (currentChecked == null) {
              return false;
            }

            event.preventDefault();
            const transaction = view.state.tr.setNodeMarkup(listItemPos, undefined, {
              ...listItemParent.node.attrs,
              checked: !currentChecked
            });
            view.dispatch(transaction);
            view.focus();
            onTaskListToggle();
            return true;
          } catch {
            return false;
          }
        }
      }
    }
  });
}

function getSelectionScrollTarget(view: EditorView) {
  const { node } = view.domAtPos(view.state.selection.head);
  if (node instanceof HTMLElement) {
    return node;
  }

  return node.parentElement ?? view.dom;
}

function scrollSelectionIntoView(view: EditorView) {
  const target = getSelectionScrollTarget(view);
  target.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function createEditorDocument(markdown: string) {
  const normalized = markdown.trim() === '' ? '\n' : markdown;
  const doc = parseMarkdown(normalized);
  if (doc.childCount > 0) {
    return doc;
  }

  return notepadSchema.node('doc', null, [notepadSchema.node('paragraph')]);
}

function createTaskListInputRule() {
  return new InputRule(/^([-+*])\s\[( |x|X)\]\s$/, (state, match) =>
    createTaskListTransaction(state, {
      checked: match[2].toLowerCase() === 'x'
    })
  );
}

function createHorizontalRuleInputRule() {
  return new InputRule(/^(?:---|\*\*\*|___)\s$/, (state) => {
    const { selection, schema } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) {
      return null;
    }

    const { $from } = selection;
    const parent = $from.parent;
    if (parent.type.name !== 'paragraph') {
      return null;
    }

    const blockPos = $from.before();
    const transaction = state.tr.replaceWith(
      blockPos,
      blockPos + parent.nodeSize,
      schema.nodes.horizontal_rule.create()
    );
    const insertPos = Math.max(1, Math.min(blockPos + 1, transaction.doc.nodeSize - 2));
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertPos)));
    return transaction;
  });
}

function insertHardBreak(state: EditorState, dispatch?: (transaction: Transaction) => void) {
  if (state.selection.$from.parent.type.spec.code) {
    return newlineInCode(state, dispatch);
  }

  const hardBreak = state.schema.nodes.hard_break;
  if (!hardBreak) {
    return false;
  }

  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create(), true).scrollIntoView());
  }

  return true;
}

function createMarkdownInputRules() {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, notepadSchema.nodes.heading, (match) => ({
        level: match[1].length
      })),
      textblockTypeInputRule(/^```(?:\s+([A-Za-z0-9_-]+))?\s$/, notepadSchema.nodes.code_block, (match) => ({
        params: match[1] ?? ''
      })),
      wrappingInputRule(/^\s*>\s$/, notepadSchema.nodes.blockquote),
      wrappingInputRule(/^\s*([-+*])\s$/, notepadSchema.nodes.bullet_list, (match) => ({
        bullet: match[1],
        tight: false
      })),
      wrappingInputRule(/^(\d+)\.\s$/, notepadSchema.nodes.ordered_list, (match) => ({
        order: Number(match[1]) || 1,
        tight: false
      })),
      createTaskListInputRule(),
      createHorizontalRuleInputRule()
    ]
  });
}

function createEditorPlugins(
  editorRoot: HTMLDivElement,
  slashMenuApi: SlashMenuAPI,
  {
    assetRootPath,
    onOpenLink,
    onActiveWikilinkChange,
    onTaskListToggle,
    onStorePastedImage
  }: Pick<
    CreateEditorOptions,
    | 'assetRootPath'
    | 'onOpenLink'
    | 'onActiveWikilinkChange'
    | 'onTaskListToggle'
    | 'onStorePastedImage'
  >
) {
  const imagesConfig: ImagesConfig = {
    assetRootPath,
    storePastedImage: onStorePastedImage
  };

  const listItemType = notepadSchema.nodes.list_item;
  const slashMenu = createSlashMenuPlugin();
  slashMenuApi.show = slashMenu.api.show;
  slashMenuApi.hide = slashMenu.api.hide;

  return [
    createMarkdownInputRules(),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      Backspace: undoInputRule,
      'Shift-Enter': insertHardBreak,
      Enter: chainCommands(
        splitListItemKeepMarks(listItemType),
        newlineInCode,
        createParagraphNear,
        liftEmptyBlock,
        splitBlockKeepMarks
      ),
      Tab: sinkListItem(listItemType),
      'Shift-Tab': liftListItem(listItemType)
    }),
    keymap(baseKeymap),
    history(),
    dropCursor({
      class: 'crepe-drop-cursor',
      width: 4,
      color: false
    }),
    gapCursor(),
    tableEditing(),
    createPlaceholderPlugin({
      text: 'Start writing',
      mode: 'doc'
    }),
    createTaskListInteractionPlugin(onTaskListToggle),
    createWikilinksPlugin({
      onOpenLink,
      onActiveWikilinkChange
    }),
    createImageEmbedsPlugin(imagesConfig),
    createImagePastePlugin(imagesConfig),
    slashMenu.plugin,
    createBlockHandlePlugin(editorRoot, slashMenu.api)
  ];
}

function createEditorState(markdown: string, plugins: Plugin[]) {
  return EditorState.create({
    schema: notepadSchema,
    doc: createEditorDocument(markdown),
    plugins
  });
}

function getBlockHandleContent(documentRoot: Document) {
  const content = documentRoot.createElement('div');
  content.className = 'milkdown-block-handle';
  content.dataset.show = 'false';
  content.style.position = 'fixed';

  const addButton = documentRoot.createElement('div');
  addButton.className = 'operation-item';
  addButton.dataset.role = 'add';
  addButton.innerHTML = addIcon;

  const dragButton = documentRoot.createElement('div');
  dragButton.className = 'operation-item';
  dragButton.dataset.role = 'drag';
  dragButton.innerHTML = dragHandleIcon;

  content.appendChild(addButton);
  content.appendChild(dragButton);

  return { content, addButton, dragButton };
}

interface ActiveBlockHandle {
  node: ProseMirrorNode;
  pos: number;
  element: HTMLElement;
}

interface BlockDropTarget {
  element: HTMLElement;
  placement: 'before' | 'after';
  targetPos: number;
  targetNode: ProseMirrorNode;
}

const BLOCK_HANDLE_SELECTOR = 'li, p, h1, h2, h3, h4, h5, h6, pre, hr';
const BLOCK_HANDLE_ANCHOR_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, pre, hr';

/** Horizontal zone for which row a block handle refers to (full editor column + left gutter). */
const BLOCK_ROW_PICK_GUTTER_LEFT = 96;
const BLOCK_ROW_VERTICAL_SLOP = 8;

function sortBlockElementsBySpecificity(elements: HTMLElement[]) {
  return [...elements].sort((left, right) => {
    if (left === right) return 0;
    if (left.contains(right)) return 1;
    if (right.contains(left)) return -1;

    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    const leftArea = leftRect.width * leftRect.height;
    const rightArea = rightRect.width * rightRect.height;

    return rightRect.left - leftRect.left || leftArea - rightArea || leftRect.top - rightRect.top;
  });
}

function resolveBlockRootElement(editorRoot: HTMLDivElement, element: Element | null) {
  if (!(element instanceof Element)) {
    return null;
  }

  const listItem = element.closest<HTMLElement>('li');
  if (listItem && editorRoot.contains(listItem)) {
    return listItem;
  }

  const block = element.closest<HTMLElement>(BLOCK_HANDLE_ANCHOR_SELECTOR);
  if (block && editorRoot.contains(block)) {
    return block;
  }

  return null;
}

/**
 * DOM used to vertically align the handle with the visible "line" for that block.
 * For `list_item`, `<li>` includes nested lists — use the first text block child for
 * vertical metrics; horizontal placement uses the `<li>` so the handle lines up with the
 * block edge (marker/checkbox + text), not only the inner paragraph.
 */
function getBlockHandleLineElement(blockElement: HTMLElement): HTMLElement {
  if (blockElement.matches('li')) {
    for (const child of Array.from(blockElement.children)) {
      if (child instanceof HTMLElement && child.matches(BLOCK_HANDLE_ANCHOR_SELECTOR)) {
        return child;
      }
    }
  }

  return blockElement;
}

/**
 * `ul`/`ol` use horizontal padding for markers; `li` starts inside that padding, so `li.left`
 * matches inner text (same mis-alignment as using `<p>`). Task lists zero out list padding and
 * pad `li` instead, so `li.left` already matches the block edge. Use the list element’s left
 * for bullet/ordered lists so the handle lines up with paragraphs and with task rows.
 */
function getListItemBlockHandleAnchorLeft(li: HTMLElement): number {
  const list = li.closest('ul, ol');
  if (list instanceof HTMLElement) {
    return list.getBoundingClientRect().left;
  }
  return li.getBoundingClientRect().left;
}

function resolveBlockContextFromElement(view: EditorView, element: HTMLElement) {
  const pos = view.posAtDOM(element, 0);
  const maxResolvedPos = Math.max(1, view.state.doc.nodeSize - 2);
  const $pos = view.state.doc.resolve(Math.max(1, Math.min(pos, maxResolvedPos)));

  if (element.matches('li')) {
    const listItem = findAncestorNode($pos, (node) => node.type.name === 'list_item');
    if (listItem) {
      return {
        node: listItem.node,
        pos: listItem.pos
      };
    }
  }

  const block = findAncestorNode($pos, (node) =>
    ['paragraph', 'heading', 'code_block', 'horizontal_rule', 'list_item'].includes(
      node.type.name
    )
  );

  if (!block) {
    return null;
  }

  return {
    node: block.node,
    pos: block.pos
  };
}

/** Parent `bullet_list` / `ordered_list` for a `list_item` that starts at `listItemStartPos`, if any. */
function getListContainerKind(
  doc: EditorState['doc'],
  listItemStartPos: number
): 'bullet_list' | 'ordered_list' | null {
  const node = doc.nodeAt(listItemStartPos);
  if (!node || node.type.name !== 'list_item') {
    return null;
  }
  const $p = doc.resolve(listItemStartPos + 1);
  for (let depth = $p.depth; depth >= 1; depth -= 1) {
    const name = $p.node(depth).type.name;
    if (name === 'bullet_list') {
      return 'bullet_list';
    }
    if (name === 'ordered_list') {
      return 'ordered_list';
    }
  }
  return null;
}

/**
 * Deleting the last `list_item` in a list would leave `list_item+` invalid; delete the whole list node.
 */
function expandDeleteRangeForListItem(
  doc: EditorState['doc'],
  sourcePos: number,
  sourceNode: ProseMirrorNode
): { from: number; to: number } {
  let from = sourcePos;
  let to = sourcePos + sourceNode.nodeSize;
  if (sourceNode.type.name !== 'list_item') {
    return { from, to };
  }

  const $p = doc.resolve(sourcePos + 1);
  const listItemBlock = findAncestorNode($p, (node) => node.type.name === 'list_item');
  if (!listItemBlock || listItemBlock.pos !== sourcePos) {
    return { from, to };
  }

  const listDepth = listItemBlock.depth - 1;
  if (listDepth < 1) {
    return { from, to };
  }

  const listNode = $p.node(listDepth);
  if (
    (listNode.type.name !== 'bullet_list' && listNode.type.name !== 'ordered_list') ||
    listNode.childCount !== 1
  ) {
    return { from, to };
  }

  return {
    from: $p.before(listDepth),
    to: $p.after(listDepth)
  };
}

function nodeToInsertAtBlockGap(
  schema: EditorState['schema'],
  sourceNode: ProseMirrorNode,
  listContainerKind: 'bullet_list' | 'ordered_list' | null,
  parent: ProseMirrorNode,
  insertIndex: number
): ProseMirrorNode | null {
  if (parent.canReplaceWith(insertIndex, insertIndex, sourceNode.type)) {
    return sourceNode;
  }

  if (sourceNode.type.name !== 'list_item') {
    return null;
  }

  const tryKinds: Array<'bullet_list' | 'ordered_list'> = listContainerKind
    ? [listContainerKind, listContainerKind === 'bullet_list' ? 'ordered_list' : 'bullet_list']
    : ['bullet_list', 'ordered_list'];

  for (const kind of tryKinds) {
    const wrapper =
      kind === 'ordered_list' ? schema.nodes.ordered_list : schema.nodes.bullet_list;
    const wrapped = wrapper.create(null, [sourceNode]);
    if (parent.canReplaceWith(insertIndex, insertIndex, wrapped.type)) {
      return wrapped;
    }
  }

  return null;
}

function createBlockHandlePlugin(editorRoot: HTMLDivElement, slashMenuApi: SlashMenuAPI) {
  const key = new PluginKey('NOTEPAD_BLOCK_HANDLE');

  class BlockHandleView {
    readonly #view: EditorView;
    readonly #content: HTMLElement;
    readonly #addButton: HTMLElement;
    readonly #dragButton: HTMLElement;
    readonly #dropIndicator: HTMLElement;
    #activeBlock: ActiveBlockHandle | null = null;
    #scrollRoot: HTMLElement | null;
    #hideTimer: number | null = null;
    #dragState:
      | {
          pointerId: number;
          originX: number;
          originY: number;
          sourcePos: number;
          source: ActiveBlockHandle;
          started: boolean;
          dropTarget: BlockDropTarget | null;
          sourceButton: HTMLElement;
        }
      | null = null;

    constructor(view: EditorView) {
      this.#view = view;
      const { content, addButton, dragButton } = getBlockHandleContent(document);
      this.#content = content;
      this.#addButton = addButton;
      this.#dragButton = dragButton;
      this.#scrollRoot = editorRoot.closest<HTMLElement>('.notepad-editor-shell');
      this.#dropIndicator = document.createElement('div');
      this.#dropIndicator.className = 'gn-block-drop-indicator';
      this.#dropIndicator.dataset.show = 'false';
      editorRoot.appendChild(content);
      editorRoot.appendChild(this.#dropIndicator);

      editorRoot.addEventListener('mousemove', this.handleEditorMouseMove, true);
      editorRoot.addEventListener('mouseleave', this.handleEditorMouseLeave, true);
      this.#content.addEventListener('mouseenter', this.handleHandleMouseEnter);
      this.#content.addEventListener('mouseleave', this.handleHandleMouseLeave);
      this.#addButton.addEventListener('pointerdown', this.handleAddPointerDown);
      this.#addButton.addEventListener('pointerup', this.handleAddPointerUp);
      this.#dragButton.addEventListener('pointerdown', this.handleDragPointerDown);
      window.addEventListener('pointermove', this.handlePointerMove, true);
      window.addEventListener('pointerup', this.handlePointerUp, true);
      window.addEventListener('pointercancel', this.handlePointerCancel, true);
      this.#scrollRoot?.addEventListener('scroll', this.handleScroll, true);
    }

    update() {
      if (this.#dragState?.started) {
        this.repositionDropIndicator();
        return;
      }

      if (this.#activeBlock?.element.isConnected) {
        this.positionHandle(this.#activeBlock.element);
      } else {
        this.hide();
      }
    }

    destroy() {
      this.clearHideTimer();
      editorRoot.removeEventListener('mousemove', this.handleEditorMouseMove, true);
      editorRoot.removeEventListener('mouseleave', this.handleEditorMouseLeave, true);
      this.#content.removeEventListener('mouseenter', this.handleHandleMouseEnter);
      this.#content.removeEventListener('mouseleave', this.handleHandleMouseLeave);
      this.#addButton.removeEventListener('pointerdown', this.handleAddPointerDown);
      this.#addButton.removeEventListener('pointerup', this.handleAddPointerUp);
      this.#dragButton.removeEventListener('pointerdown', this.handleDragPointerDown);
      window.removeEventListener('pointermove', this.handlePointerMove, true);
      window.removeEventListener('pointerup', this.handlePointerUp, true);
      window.removeEventListener('pointercancel', this.handlePointerCancel, true);
      this.#scrollRoot?.removeEventListener('scroll', this.handleScroll, true);
      document.body.classList.remove('gn-block-dragging');
      this.#content.remove();
      this.#dropIndicator.remove();
    }

    private clearHideTimer() {
      if (this.#hideTimer !== null) {
        window.clearTimeout(this.#hideTimer);
        this.#hideTimer = null;
      }
    }

    private scheduleHide() {
      if (this.#dragState?.started) {
        return;
      }

      this.clearHideTimer();
      this.#hideTimer = window.setTimeout(() => {
        this.hide();
      }, 110);
    }

    private handleEditorMouseMove = (event: MouseEvent) => {
      if (this.#dragState?.started) {
        return;
      }

      if (event.target instanceof Node && this.#content.contains(event.target)) {
        this.clearHideTimer();
        return;
      }

      const element = this.resolveBlockElement(event.clientX, event.clientY);
      if (!element) {
        this.scheduleHide();
        return;
      }

      this.clearHideTimer();
      this.activateBlock(element);
    };

    private handleEditorMouseLeave = () => {
      this.scheduleHide();
    };

    private handleHandleMouseEnter = () => {
      this.clearHideTimer();
    };

    private handleHandleMouseLeave = () => {
      this.scheduleHide();
    };

    private handleAddPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.clearHideTimer();
      this.#addButton.classList.add('active');
    };

    private handleAddPointerUp = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.#addButton.classList.remove('active');

      if (!this.#activeBlock) {
        return;
      }

      if (!this.#view.hasFocus()) {
        this.#view.focus();
      }

      const pos = this.#activeBlock.pos + this.#activeBlock.node.nodeSize;
      let transaction = this.#view.state.tr.insert(
        pos,
        this.#view.state.schema.nodes.paragraph.create()
      );
      transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(pos)));
      this.#view.dispatch(transaction.scrollIntoView());

      this.hide();
      slashMenuApi.show(transaction.selection.from);
    };

    private handleDragPointerDown = (event: PointerEvent) => {
      if (!this.#activeBlock) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.clearHideTimer();
      this.#dragButton.classList.add('active');
      try {
        this.#dragButton.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures and fall back to window-level listeners.
      }
      this.#dragState = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        sourcePos: this.#activeBlock.pos,
        source: this.#activeBlock,
        started: false,
        dropTarget: null,
        sourceButton: this.#dragButton
      };
    };

    private handlePointerMove = (event: PointerEvent) => {
      if (!this.#dragState || event.pointerId !== this.#dragState.pointerId) {
        return;
      }

      const delta = Math.hypot(
        event.clientX - this.#dragState.originX,
        event.clientY - this.#dragState.originY
      );
      if (!this.#dragState.started && delta > 6) {
        this.#dragState.started = true;
        this.#content.dataset.dragging = 'true';
        document.body.classList.add('gn-block-dragging');
      }

      if (this.#dragState.started) {
        event.preventDefault();
        this.#dragState.dropTarget = this.resolveDropTarget(event.clientX, event.clientY);
        this.repositionDropIndicator();
      }
    };

    private handleScroll = () => {
      if (this.#dragState?.started) {
        this.repositionDropIndicator();
        return;
      }

      if (this.#activeBlock?.element.isConnected) {
        this.positionHandle(this.#activeBlock.element);
      }
    };

    private handlePointerUp = (event: PointerEvent) => {
      if (!this.#dragState || event.pointerId !== this.#dragState.pointerId) {
        return;
      }

      const dragState = this.#dragState;
      this.#dragState = null;
      this.finishDragInteraction(dragState.pointerId, dragState.sourceButton);

      if (!dragState.started || !dragState.dropTarget) {
        return;
      }

      event.preventDefault();
      this.commitBlockMove(dragState.sourcePos, dragState.dropTarget);
      this.hide();
    };

    private handlePointerCancel = (event: PointerEvent) => {
      if (!this.#dragState || event.pointerId !== this.#dragState.pointerId) {
        return;
      }

      const dragState = this.#dragState;
      this.#dragState = null;
      this.finishDragInteraction(event.pointerId, dragState.sourceButton);
    };

    private activateBlock(element: HTMLElement) {
      try {
        const context = resolveBlockContextFromElement(this.#view, element);
        if (!context) {
          this.hide();
          return;
        }

        const $pos = this.#view.state.doc.resolve(context.pos + 1);
        if (findAncestorNode($pos, (node) => ['table', 'blockquote'].includes(node.type.name))) {
          this.hide();
          return;
        }
        this.#activeBlock = {
          node: context.node,
          pos: context.pos,
          element
        };
        this.#content.dataset.blockPos = String(context.pos);
        this.positionHandle(element);
      } catch {
        this.hide();
      }
    }

    private resolveBlockElement(clientX: number, clientY: number) {
      const prose = getEditorProseSurface(this.#view);
      const proseRect = prose.getBoundingClientRect();
      const inRowPickZone =
        clientX >= proseRect.left - BLOCK_ROW_PICK_GUTTER_LEFT &&
        clientX <= proseRect.right + 4;

      const handleRect = this.#content.getBoundingClientRect();
      if (
        this.#activeBlock?.element.isConnected &&
        clientX >= handleRect.left - 16 &&
        clientX <= handleRect.right + 16 &&
        clientY >= handleRect.top - 14 &&
        clientY <= handleRect.bottom + 14
      ) {
        return this.#activeBlock.element;
      }

      if (!inRowPickZone) {
        return null;
      }

      const elements = document
        .elementsFromPoint(clientX, clientY)
        .filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement)
        .filter((candidate) => editorRoot.contains(candidate) && !this.#content.contains(candidate));

      const matchedBlocks = new Set<HTMLElement>();
      for (const candidate of elements) {
        const block = resolveBlockRootElement(editorRoot, candidate);
        if (block) {
          matchedBlocks.add(block);
        }
      }

      const sortedMatches = sortBlockElementsBySpecificity([...matchedBlocks]);
      if (sortedMatches.length > 0) {
        const picked = sortedMatches[0];
        if (picked) {
          const bounds = picked.getBoundingClientRect();
          if (
            clientY >= bounds.top - BLOCK_ROW_VERTICAL_SLOP &&
            clientY <= bounds.bottom + BLOCK_ROW_VERTICAL_SLOP
          ) {
            return picked;
          }
        }
      }

      const candidates = sortBlockElementsBySpecificity(
        Array.from(prose.querySelectorAll<HTMLElement>(BLOCK_HANDLE_SELECTOR))
          .map((candidate) => resolveBlockRootElement(editorRoot, candidate))
          .filter((candidate): candidate is HTMLElement => candidate !== null)
      );

      let best: HTMLElement | null = null;
      let bestScore = Infinity;
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (
          clientY < rect.top - BLOCK_ROW_VERTICAL_SLOP ||
          clientY > rect.bottom + BLOCK_ROW_VERTICAL_SLOP
        ) {
          continue;
        }
        const midY = (rect.top + rect.bottom) / 2;
        const score = Math.abs(clientY - midY);
        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      return best;
    }

    private resolveDropTarget(clientX: number, clientY: number): BlockDropTarget | null {
      const source = this.#dragState?.source;
      if (!source) {
        return null;
      }

      // Prefer the pointer column so narrow blocks (e.g. list items) stay targetable; offset helps when the drag handle overlaps the gutter.
      const probeXs = [clientX, clientX + 20, clientX + 40, clientX + 64, clientX + 96];

      for (const probeX of probeXs) {
        const element = this.resolveBlockElement(probeX, clientY);
        if (!element) {
          continue;
        }

        try {
          const context = resolveBlockContextFromElement(this.#view, element);
          if (!context || context.pos === source.pos) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          const placement = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
          return {
            element,
            placement,
            targetPos: context.pos,
            targetNode: context.node
          };
        } catch {
          continue;
        }
      }

      return null;
    }

    private repositionDropIndicator() {
      const dropTarget = this.#dragState?.dropTarget;
      if (!dropTarget) {
        this.hideDropIndicator();
        return;
      }

      const prose = getEditorProseSurface(this.#view);
      const proseRect = prose.getBoundingClientRect();
      const rect = dropTarget.element.getBoundingClientRect();
      const top =
        dropTarget.placement === 'before' ? rect.top - 2 : rect.bottom - 2;

      this.#dropIndicator.style.left = `${Math.round(proseRect.left)}px`;
      this.#dropIndicator.style.top = `${Math.round(top)}px`;
      this.#dropIndicator.style.width = `${Math.round(proseRect.width)}px`;
      this.#dropIndicator.dataset.show = 'true';
    }

    private hideDropIndicator() {
      this.#dropIndicator.dataset.show = 'false';
    }

    private finishDragInteraction(pointerId: number, sourceButton: HTMLElement) {
      sourceButton.classList.remove('active');
      this.#content.dataset.dragging = 'false';
      document.body.classList.remove('gn-block-dragging');
      this.hideDropIndicator();
      try {
        if (sourceButton.hasPointerCapture(pointerId)) {
          sourceButton.releasePointerCapture(pointerId);
        }
      } catch {
        // Ignore release failures during teardown or synthetic pointer transitions.
      }
    }

    private commitBlockMove(sourcePos: number, dropTarget: BlockDropTarget) {
      const state = this.#view.state;
      const sourceNode = state.doc.nodeAt(sourcePos);
      if (!sourceNode) {
        return;
      }

      const listKind = getListContainerKind(state.doc, sourcePos);
      const { from: deleteFrom, to: deleteTo } = expandDeleteRangeForListItem(
        state.doc,
        sourcePos,
        sourceNode
      );

      const initialInsertPos =
        dropTarget.placement === 'before'
          ? dropTarget.targetPos
          : dropTarget.targetPos + dropTarget.targetNode.nodeSize;

      if (
        initialInsertPos === deleteFrom ||
        initialInsertPos === deleteTo ||
        (initialInsertPos >= deleteFrom && initialInsertPos <= deleteTo)
      ) {
        return;
      }

      const transaction = state.tr.delete(deleteFrom, deleteTo);
      const mappedInsertPos = transaction.mapping.map(
        initialInsertPos,
        dropTarget.placement === 'before' ? -1 : 1
      );
      const clampedInsertPos = Math.max(0, Math.min(mappedInsertPos, transaction.doc.content.size));
      const resolvedInsert = transaction.doc.resolve(clampedInsertPos);
      const insertIndex = resolvedInsert.index();
      const toInsert = nodeToInsertAtBlockGap(
        state.schema,
        sourceNode,
        listKind,
        resolvedInsert.parent,
        insertIndex
      );
      if (!toInsert) {
        return;
      }

      transaction.insert(clampedInsertPos, toInsert);
      const selectionPos = Math.max(
        1,
        Math.min(clampedInsertPos + 1, transaction.doc.nodeSize - 2)
      );
      transaction.setSelection(Selection.near(transaction.doc.resolve(selectionPos)));
      this.#view.dispatch(transaction.scrollIntoView());
      this.#view.focus();
    }

    private positionHandle(blockElement: HTMLElement) {
      this.#content.dataset.show = 'true';
      const lineEl = getBlockHandleLineElement(blockElement);
      const lineRect = lineEl.getBoundingClientRect();
      const handleRect = this.#content.getBoundingClientRect();
      const handleWidth = handleRect.width || 72;
      const handleHeight = handleRect.height || 32;
      const gap = 6;
      const anchorLeft = blockElement.matches('li')
        ? getListItemBlockHandleAnchorLeft(blockElement)
        : lineRect.left;
      const left = Math.round(anchorLeft - handleWidth - gap);
      const top = Math.round(lineRect.top + lineRect.height / 2 - handleHeight / 2);
      this.#content.style.left = `${left}px`;
      this.#content.style.top = `${top}px`;
    }

    private hide() {
      this.clearHideTimer();
      this.#activeBlock = null;
      this.#content.dataset.show = 'false';
      this.#content.dataset.dragging = 'false';
      delete this.#content.dataset.blockPos;
    }
  }

  return new Plugin({
    key,
    view: (view) => new BlockHandleView(view)
  });
}

const blockHandleMenuCleanupByEditor = new WeakMap<EditorController, () => void>();

// ── Editor lifecycle ─────────────────────────────────────────────────

export async function prepareEditor(editorRoot: HTMLDivElement | null) {
  if (!editorRoot) return false;
  await tick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return !!editorRoot;
}

export async function createEditor({
  assetRootPath,
  editorRoot,
  initialValue,
  onOpenLink,
  onActiveWikilinkChange,
  onMarkdownChange,
  onTaskListToggle,
  onStorePastedImage
}: CreateEditorOptions) {
  editorRoot.classList.add('gn-editor-root');

  const slashMenuApi: SlashMenuAPI = {
    show: () => {},
    hide: () => {}
  };

  const plugins = createEditorPlugins(editorRoot, slashMenuApi, {
    assetRootPath,
    onOpenLink,
    onActiveWikilinkChange,
    onTaskListToggle,
    onStorePastedImage
  });
  const state = createEditorState(initialValue, plugins);

  const view = new EditorView(editorRoot, {
    state,
    attributes: {
      spellcheck: 'true',
      autocorrect: 'on',
      autocapitalize: 'sentences'
    },
    dispatchTransaction(transaction) {
      const nextState = view.state.apply(transaction);
      view.updateState(nextState);
      if (transaction.docChanged) {
        onMarkdownChange(serializeMarkdown(nextState.doc));
      }
    }
  });

  const controller: EditorController = {
    view,
    plugins,
    slashMenuApi
  };

  const menuCleanup = setupBlockHandleTypeMenu(controller, editorRoot);
  blockHandleMenuCleanupByEditor.set(controller, menuCleanup);
  return controller;
}

export async function destroyEditor(controller: EditorController | null) {
  if (!controller) return null;

  const menuCleanup = blockHandleMenuCleanupByEditor.get(controller);
  if (menuCleanup) {
    menuCleanup();
    blockHandleMenuCleanupByEditor.delete(controller);
  }

  controller.view.destroy();
  return null;
}

export function replaceEditorContent(
  controller: EditorController | null,
  markdown: string,
  { flushHistory = false }: ReplaceEditorContentOptions = {}
) {
  if (!controller) {
    return false;
  }

  const nextState = createEditorState(markdown, controller.plugins);
  controller.view.updateState(
    flushHistory ? EditorState.create({ schema: notepadSchema, doc: nextState.doc, plugins: controller.plugins }) : nextState
  );
  return true;
}

export function readEditorState(controller: EditorController | null): EditorState | null {
  return controller?.view.state ?? null;
}

export function replaceEditorState(
  controller: EditorController | null,
  state: EditorState | null,
  {
    focus = true,
    scrollSelectionIntoView: shouldScrollSelectionIntoView = true
  }: ReplaceEditorStateOptions = {}
) {
  if (!controller || !state) {
    return false;
  }

  controller.view.updateState(state);
  if (focus) {
    controller.view.focus();
  }
  if (shouldScrollSelectionIntoView) {
    window.requestAnimationFrame(() => {
      scrollSelectionIntoView(controller.view);
    });
  }

  return true;
}

export function readCursorPosition(
  controller: EditorController | null
): CursorPosition | null {
  if (!controller) {
    return null;
  }

  return {
    anchor: controller.view.state.selection.anchor,
    head: controller.view.state.selection.head
  };
}

export function restoreCursorPosition(
  controller: EditorController | null,
  position: CursorPosition | null
) {
  if (!controller || !position) {
    return false;
  }

  const view = controller.view;
  const maxPos = Math.max(1, view.state.doc.nodeSize - 2);
  const anchor = Math.max(1, Math.min(position.anchor, maxPos));
  const head = Math.max(1, Math.min(position.head, maxPos));
  const transaction = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, anchor, head))
    .scrollIntoView();

  view.dispatch(transaction);
  view.focus();
  window.requestAnimationFrame(() => {
    scrollSelectionIntoView(view);
  });
  return true;
}

export function resetSlashMenuPortal({
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

  return setupSlashMenuPortal({
    boundsElement,
    editorRoot,
    portalRoot
  });
}

export function insertWikilinkSuggestion(
  controller: EditorController | null,
  activeWikilink: ActiveWikilink | null,
  suggestionValue: string
) {
  if (!controller || !activeWikilink) {
    return false;
  }

  const transaction = controller.view.state.tr.insertText(
    suggestionValue,
    activeWikilink.targetFrom,
    activeWikilink.targetTo
  );
  const cursorPosition = activeWikilink.targetFrom + suggestionValue.length;
  transaction.setSelection(TextSelection.create(transaction.doc, cursorPosition));
  controller.view.dispatch(transaction);
  controller.view.focus();
  return true;
}
