import type { Ctx } from '@milkdown/kit/ctx';
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx
} from '@milkdown/kit/core';
import { block, blockConfig, BlockProvider, type BlockProviderOptions } from '@milkdown/kit/plugin/block';
import { listItemBlockComponent, listItemBlockConfig } from '@milkdown/kit/component/list-item-block';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { cursor, dropIndicatorConfig } from '@milkdown/kit/plugin/cursor';
import { history } from '@milkdown/kit/plugin/history';
import { indent, indentConfig } from '@milkdown/kit/plugin/indent';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { trailing } from '@milkdown/kit/plugin/trailing';
import {
  hrSchema,
  paragraphSchema
} from '@milkdown/kit/preset/commonmark';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { findParent } from '@milkdown/kit/prose';
import { type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { EditorState, Plugin, PluginKey, TextSelection, type PluginView, type Selection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $ctx, $prose, replaceAll } from '@milkdown/kit/utils';
import { tick } from 'svelte';
import type { CursorPosition } from '$lib/features/notepad/editor/cursorState';
import { slashMenu, slashMenuAPI, configureSlashMenu } from '$lib/features/notepad/editor/slashMenu';
import { isDocEmpty, isInCodeContext, isInList } from '$lib/features/notepad/editor/editorSelection';
import { setupBlockHandleTypeMenu } from '$lib/features/notepad/editor/blockTypeMenu';
import { useImages } from '$lib/features/notepad/images/images';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import { useWikilinks, type ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
import { setupSlashMenuPortal } from '$lib/features/notepad/editor/slashMenuPortal';

interface CreateEditorOptions {
  assetRootPath: string | null;
  editorRoot: HTMLDivElement;
  initialValue: string;
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
  onMarkdownChange: (markdown: string) => void;
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

export interface EditorController {
  editor: Editor;
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

const bulletListLabel = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <circle cx="8" cy="8" r="2.4" />
  </svg>
`;

const taskListCheckedLabel = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM10.71 16.29C10.32 16.68 9.69 16.68 9.3 16.29L5.71 12.7C5.32 12.31 5.32 11.68 5.71 11.29C6.1 10.9 6.73 10.9 7.12 11.29L10 14.17L16.88 7.29C17.27 6.9 17.9 6.9 18.29 7.29C18.68 7.68 18.68 8.31 18.29 8.7L10.71 16.29Z"
    />
  </svg>
`;

const taskListUncheckedLabel = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M18 19H6C5.45 19 5 18.55 5 18V6C5 5.45 5.45 5 6 5H18C18.55 5 19 5.45 19 6V18C19 18.55 18.55 19 18 19ZM19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3Z"
    />
  </svg>
`;

// ── Placeholder ──────────────────────────────────────────────────────

interface PlaceholderConfig {
  text: string;
  mode: 'doc' | 'block';
}

const placeholderConfig = $ctx<PlaceholderConfig, 'placeholderConfig'>(
  {
    text: 'Start writing',
    mode: 'doc'
  },
  'placeholderConfig'
);

function createPlaceholderDecoration(
  state: EditorState,
  placeholderText: string
): Decoration | null {
  const { selection } = state;
  if (!selection.empty) return null;

  const $pos = selection.$anchor;
  const node = $pos.parent;
  if (node.content.size > 0) return null;

  const inTable = findParent((candidate) => candidate.type.name === 'table')($pos);
  if (inTable) return null;

  const before = $pos.before();
  return Decoration.node(before, before + node.nodeSize, {
    class: 'crepe-placeholder',
    'data-placeholder': placeholderText
  });
}

const placeholderPlugin = $prose((ctx) => {
  return new Plugin({
    key: new PluginKey('NOTEPAD_PLACEHOLDER'),
    props: {
      decorations: (state) => {
        const config = ctx.get(placeholderConfig.key);

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
});

// ── Block handle ─────────────────────────────────────────────────────

function getBlockHandleContent(documentRoot: Document) {
  const content = documentRoot.createElement('div');
  content.className = 'milkdown-block-handle';
  content.dataset.show = 'false';

  const addButton = documentRoot.createElement('div');
  addButton.className = 'operation-item';
  addButton.innerHTML = addIcon;

  const dragButton = documentRoot.createElement('div');
  dragButton.className = 'operation-item';
  dragButton.innerHTML = dragHandleIcon;

  content.appendChild(addButton);
  content.appendChild(dragButton);

  return { content, addButton };
}

class BlockHandleView implements PluginView {
  readonly #ctx: Ctx;
  readonly #provider: BlockProvider;
  readonly #content: HTMLElement;
  readonly #addButton: HTMLElement;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    const documentRoot = document;
    const { content, addButton } = getBlockHandleContent(documentRoot);
    this.#content = content;
    this.#addButton = addButton;

    this.#addButton.addEventListener('pointerdown', this.handleAddPointerDown);
    this.#addButton.addEventListener('pointerup', this.handleAddPointerUp);

    const blockProviderOptions: Partial<BlockProviderOptions> = {};
    this.#provider = new BlockProvider({
      ctx,
      content,
      getOffset: () => 16,
      getPlacement: ({ active, blockDom }) => {
        if (active.node.type.name === 'heading') return 'left';

        let totalDescendant = 0;
        active.node.descendants((node) => {
          totalDescendant += node.childCount;
        });

        const domRect = active.el.getBoundingClientRect();
        const handleRect = blockDom.getBoundingClientRect();
        const style = window.getComputedStyle(active.el);
        const paddingTop = Number.parseInt(style.paddingTop, 10) || 0;
        const paddingBottom = Number.parseInt(style.paddingBottom, 10) || 0;
        const height = domRect.height - paddingTop - paddingBottom;
        const handleHeight = handleRect.height;
        return totalDescendant > 2 || handleHeight < height ? 'left-start' : 'left';
      },
      ...blockProviderOptions
    });
    this.update();
  }

  update = () => {
    this.#provider.update();
  };

  destroy = () => {
    this.#addButton.removeEventListener('pointerdown', this.handleAddPointerDown);
    this.#addButton.removeEventListener('pointerup', this.handleAddPointerUp);
    this.#provider.destroy();
    this.#content.remove();
  };

  private handleAddPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.#addButton.classList.add('active');
  };

  private handleAddPointerUp = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.#addButton.classList.remove('active');

    const view = this.#ctx.get(editorViewCtx);
    if (!view.hasFocus()) {
      view.focus();
    }

    const active = this.#provider.active;
    if (!active) {
      return;
    }

    const pos = active.$pos.pos + active.node.nodeSize;
    let transaction = view.state.tr.insert(pos, paragraphSchema.type(this.#ctx).create());
    transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(pos)));
    view.dispatch(transaction.scrollIntoView());

    this.#provider.hide();
    this.#ctx.get(slashMenuAPI.key).show(transaction.selection.from);
  };
}

function configureBlockHandle(ctx: Ctx) {
  ctx.set(blockConfig.key, {
    filterNodes: (pos) => {
      const filtered = findParent((node) =>
        ['table', 'blockquote', 'math_inline'].includes(node.type.name)
      )(pos);
      return !filtered;
    }
  });
  ctx.set(block.key, {
    view: () => new BlockHandleView(ctx)
  });
}

const blockHandleMenuCleanupByEditor = new WeakMap<EditorController, () => void>();

type DropIndicatorOptions = {
  width: number;
  color: string | false;
  class: string;
};
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
  onStorePastedImage
}: CreateEditorOptions) {
  const editor = Editor.make();
  useImages(editor, {
    assetRootPath,
    storePastedImage: onStorePastedImage
  });
  editor
    .config((ctx) => {
      ctx.set(rootCtx, editorRoot);
      ctx.set(defaultValueCtx, initialValue);
      ctx.set(editorViewOptionsCtx, {
        editable: () => true,
        attributes: {
          spellcheck: 'true',
          autocorrect: 'on',
          autocapitalize: 'sentences'
        }
      });
      ctx.update(dropIndicatorConfig.key, (): DropIndicatorOptions => ({
        class: 'crepe-drop-cursor',
        width: 4,
        color: false
      }));
      ctx.update(listItemBlockConfig.key, () => ({
        renderLabel: ({ label, listType, checked }) => {
          if (checked == null) {
            return listType === 'bullet' ? bulletListLabel : label;
          }

          return checked ? taskListCheckedLabel : taskListUncheckedLabel;
        }
      }));
      ctx.update(indentConfig.key, (value) => ({
        ...value,
        size: 4
      }));
      configureSlashMenu(ctx);
      configureBlockHandle(ctx);
    })
    .use(commonmark)
    .use(listener)
    .use(cursor)
    .use(history)
    .use(indent)
    .use(trailing)
    .use(clipboard)
    .use(gfm)
    .use(listItemBlockComponent)
    .use(placeholderConfig)
    .use(placeholderPlugin)
    .use(slashMenuAPI)
    .use(slashMenu)
    .use(block)
    .config((ctx) => {
      ctx.get(listenerCtx).markdownUpdated((_listenerCtx, markdown) => {
        onMarkdownChange(markdown);
      });
    });

  useWikilinks(editor, {
    onOpenLink,
    onActiveWikilinkChange
  });

  await editor.create();

  const controller: EditorController = { editor };
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

  await controller.editor.destroy();
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

  controller.editor.action(replaceAll(markdown, flushHistory));
  return true;
}

export function readEditorState(controller: EditorController | null): EditorState | null {
  if (!controller) {
    return null;
  }

  let state: EditorState | null = null;
  controller.editor.action((ctx) => {
    state = ctx.get(editorViewCtx).state;
  });
  return state;
}

export function replaceEditorState(
  controller: EditorController | null,
  state: EditorState | null
) {
  if (!controller || !state) {
    return false;
  }

  controller.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.updateState(state);
    view.focus();
    window.requestAnimationFrame(() => {
      scrollSelectionIntoView(view);
    });
  });

  return true;
}

export function readCursorPosition(
  controller: EditorController | null
): CursorPosition | null {
  if (!controller) {
    return null;
  }

  let position: CursorPosition | null = null;
  controller.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    position = {
      anchor: view.state.selection.anchor,
      head: view.state.selection.head
    };
  });
  return position;
}

export function restoreCursorPosition(
  controller: EditorController | null,
  position: CursorPosition | null
) {
  if (!controller || !position) {
    return false;
  }

  let restored = false;
  controller.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
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
    restored = true;
  });

  return restored;
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

  controller.editor.action((ctx) => {
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
