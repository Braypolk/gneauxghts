import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  applyBlockTypeSelection,
  blockTypeIcons,
  slashMenuGroups,
  slashMenuOptionIds,
  type EditorMenuOption
} from '$lib/features/notepad/editor/blockTypes';
import { isInCodeContext, isInList } from '$lib/features/notepad/editor/editorSelection';

interface SlashMenuItemWithIndex extends EditorMenuOption {
  index: number;
}

interface SlashMenuGroupWithItems {
  key: string;
  label: string;
  range: readonly [number, number];
  items: SlashMenuItemWithIndex[];
}

interface SlashMenuState {
  groups: SlashMenuGroupWithItems[];
  size: number;
}

export interface SlashMenuAPI {
  show: (pos: number) => void;
  hide: () => void;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getSlashMenuState(filter = ''): SlashMenuState {
  const normalizedFilter = filter.trim().toLowerCase();
  const groups: SlashMenuGroupWithItems[] = [];
  let index = 0;

  for (const group of slashMenuGroups) {
    const items = group.items
      .filter((item) => {
        if (normalizedFilter === '') {
          return true;
        }

        return item.label.toLowerCase().includes(normalizedFilter);
      })
      .map((item) => ({
        ...item,
        index: index++
      }));

    if (items.length === 0) {
      continue;
    }

    groups.push({
      key: group.key,
      label: group.label,
      range: [items[0].index, items[items.length - 1].index + 1],
      items
    });
  }

  return {
    groups,
    size: index
  };
}

function isSelectionAtEndOfNode(view: EditorView) {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) {
    return false;
  }

  const { $head } = selection;
  return $head.parentOffset === $head.parent.content.size;
}

function replaceCurrentBlockWithTaskList(view: EditorView) {
  const { selection, schema } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty || !isSelectionAtEndOfNode(view)) {
    return false;
  }

  const { $from } = selection;
  const parent = $from.parent;
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') {
    return false;
  }

  const blockPos = $from.before();
  const paragraph = schema.nodes.paragraph.create();
  const listItem = schema.nodes.list_item.create({ checked: false }, paragraph);
  const taskList = schema.nodes.bullet_list.create({ bullet: '-', tight: false }, listItem);
  const transaction = view.state.tr.replaceWith(blockPos, blockPos + parent.nodeSize, taskList);
  transaction.setSelection(TextSelection.create(transaction.doc, blockPos + 3));
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function runSlashMenuSelection(view: EditorView, optionId: string) {
  if (!slashMenuOptionIds.has(optionId)) {
    return;
  }

  if (optionId === 'taskList' && replaceCurrentBlockWithTaskList(view)) {
    return;
  }

  const selection = view.state.selection;
  if (selection instanceof TextSelection) {
    const { $from } = selection;
    const parent = $from.parent;
    if (
      isSelectionAtEndOfNode(view) &&
      (parent.type.name === 'paragraph' || parent.type.name === 'heading')
    ) {
      const from = $from.start();
      const to = $from.end();
      const transaction = view.state.tr.deleteRange(from, to);
      transaction.setSelection(TextSelection.create(transaction.doc, from));
      view.dispatch(transaction);
    }
  }

  applyBlockTypeSelection(view, optionId);
}

function consumeKeyEvent(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function getCurrentText(view: EditorView) {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) {
    return null;
  }

  const parent = selection.$from.parent;
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') {
    return null;
  }

  return parent.textBetween(0, parent.content.size, '\n', '\0');
}

class SlashMenuView {
  readonly #content: HTMLElement;
  #filter = '';
  #hoverIndex = 0;
  #view: EditorView;
  #programmaticPos: number | null = null;
  #menuState: SlashMenuState = getSlashMenuState();

  constructor(view: EditorView, api: SlashMenuAPI) {
    this.#view = view;

    const content = document.createElement('div');
    content.className = 'milkdown-slash-menu';
    content.dataset.show = 'false';
    content.style.position = 'fixed';
    content.style.left = '0px';
    content.style.top = '0px';
    content.addEventListener('pointerdown', this.handlePointerDown);
    content.addEventListener('pointermove', this.handlePointerMove);
    content.addEventListener('pointerup', this.handlePointerUp);
    this.#content = content;

    const mountRoot = view.dom.parentElement ?? view.dom;
    mountRoot.appendChild(content);

    api.show = (pos) => this.show(pos);
    api.hide = () => this.hide();

    window.addEventListener('keydown', this.handleWindowKeydown, true);
    window.addEventListener('resize', this.handleWindowResize, true);
    this.update(view);
  }

  update(view: EditorView) {
    this.#view = view;
    const shouldShow = this.shouldShow();
    if (!shouldShow) {
      this.hide();
      return;
    }

    if (this.#content.dataset.show !== 'true') {
      this.#content.dataset.show = 'true';
    }

    this.render();
    this.position();
  }

  show(pos: number) {
    this.#programmaticPos = pos;
    this.#filter = '';
    this.#menuState = getSlashMenuState('');
    this.#hoverIndex = 0;
    this.update(this.#view);
  }

  hide() {
    this.#programmaticPos = null;
    this.#content.dataset.show = 'false';
  }

  destroy() {
    window.removeEventListener('keydown', this.handleWindowKeydown, true);
    window.removeEventListener('resize', this.handleWindowResize, true);
    this.#content.removeEventListener('pointerdown', this.handlePointerDown);
    this.#content.removeEventListener('pointermove', this.handlePointerMove);
    this.#content.removeEventListener('pointerup', this.handlePointerUp);
    this.#content.remove();
  }

  private shouldShow() {
    if (isInCodeContext(this.#view.state.selection) || isInList(this.#view.state.selection)) {
      return false;
    }

    if (!isSelectionAtEndOfNode(this.#view)) {
      return false;
    }

    const currentText = getCurrentText(this.#view);
    if (currentText == null) {
      return false;
    }

    if (typeof this.#programmaticPos === 'number') {
      const maxSize = this.#view.state.doc.nodeSize - 2;
      const validPos = Math.min(this.#programmaticPos, maxSize);
      const targetParent = this.#view.state.doc.resolve(validPos).parent;
      const activeParent = this.#view.state.selection.$from.parent;
      if (targetParent !== activeParent) {
        this.#programmaticPos = null;
        return false;
      }

      this.#filter = '';
      this.#menuState = getSlashMenuState('');
      this.#hoverIndex = Math.min(this.#hoverIndex, Math.max(0, this.#menuState.size - 1));
      return true;
    }

    if (!currentText.startsWith('/')) {
      return false;
    }

    this.#filter = currentText.slice(1);
    this.#menuState = getSlashMenuState(this.#filter);
    this.#hoverIndex = Math.min(this.#hoverIndex, Math.max(0, this.#menuState.size - 1));
    return true;
  }

  private position() {
    const anchorPos = this.#programmaticPos ?? this.#view.state.selection.from;
    const coords = this.#view.coordsAtPos(anchorPos);
    const left = Math.round(coords.left);
    const top = Math.round(coords.bottom + 10);
    this.#content.style.left = `${left}px`;
    this.#content.style.top = `${top}px`;
  }

  private render() {
    if (this.#menuState.size === 0) {
      this.hide();
      return;
    }

    this.#content.dataset.show = 'true';
    this.#content.innerHTML = `
      <nav class="tab-group">
        <ul>
          ${this.#menuState.groups
            .map(
              (group) => `
                <li
                  data-tab-group="${escapeHtml(group.key)}"
                  class="${
                    this.#hoverIndex >= group.range[0] && this.#hoverIndex < group.range[1]
                      ? 'selected'
                      : ''
                  }"
                >
                  ${escapeHtml(group.label)}
                </li>
              `
            )
            .join('')}
        </ul>
      </nav>
      <div class="menu-groups">
        ${this.#menuState.groups
          .map(
            (group) => `
              <div class="menu-group" data-group="${escapeHtml(group.key)}">
                <h6>${escapeHtml(group.label)}</h6>
                <ul>
                  ${group.items
                    .map(
                      (item) => `
                        <li
                          data-index="${item.index}"
                          data-option="${escapeHtml(item.id)}"
                          class="${item.index === this.#hoverIndex ? 'hover' : ''}"
                        >
                          ${blockTypeIcons[item.id] ?? ''}
                          <span>${escapeHtml(item.label)}</span>
                        </li>
                      `
                    )
                    .join('')}
                </ul>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  }

  private runAtIndex(index: number, { hideMenu = true }: { hideMenu?: boolean } = {}) {
    const item = this.#menuState.groups
      .flatMap((group) => group.items)
      .find((candidate) => candidate.index === index);
    if (!item) {
      return;
    }

    runSlashMenuSelection(this.#view, item.id);
    if (hideMenu) {
      this.hide();
    }
  }

  private scrollToIndex(index: number) {
    const target = this.#content.querySelector<HTMLElement>(`li[data-index="${index}"]`);
    const scrollRoot = this.#content.querySelector<HTMLElement>('.menu-groups');
    if (!target || !scrollRoot) {
      return;
    }

    scrollRoot.scrollTop = target.offsetTop - scrollRoot.offsetTop;
  }

  private setHoverIndex(index: number) {
    if (this.#menuState.size === 0) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(index, this.#menuState.size - 1));
    if (nextIndex === this.#hoverIndex) {
      return;
    }

    this.#hoverIndex = nextIndex;
    this.render();
    this.scrollToIndex(nextIndex);
  }

  private handlePointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('li[data-index]') : null;
    target?.classList.add('active');
  };

  private handlePointerMove = (event: PointerEvent) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('li[data-index]') : null;
    if (!target) {
      return;
    }

    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) {
      this.setHoverIndex(index);
    }
  };

  private handlePointerUp = (event: PointerEvent) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('li[data-index]') : null;
    if (target) {
      target.classList.remove('active');
      const index = Number(target.dataset.index);
      if (Number.isFinite(index)) {
        this.runAtIndex(index);
        return;
      }
    }

    const tab =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('li[data-tab-group]')
        : null;
    if (!tab) {
      return;
    }

    const groupKey = tab.dataset.tabGroup;
    const group = this.#menuState.groups.find((candidate) => candidate.key === groupKey);
    if (!group) {
      return;
    }

    this.setHoverIndex(group.range[0]);
  };

  private handleWindowKeydown = (event: KeyboardEvent) => {
    if (this.#content.dataset.show !== 'true') {
      return;
    }

    if (event.key === 'Escape') {
      consumeKeyEvent(event);
      this.hide();
      return;
    }

    if (event.key === 'ArrowDown') {
      consumeKeyEvent(event);
      this.setHoverIndex(this.#hoverIndex + 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      consumeKeyEvent(event);
      this.setHoverIndex(this.#hoverIndex - 1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      consumeKeyEvent(event);
      const group = this.#menuState.groups.find(
        (candidate) =>
          this.#hoverIndex >= candidate.range[0] && this.#hoverIndex < candidate.range[1]
      );
      if (!group) {
        return;
      }

      const previousGroup = this.#menuState.groups[this.#menuState.groups.indexOf(group) - 1];
      if (previousGroup) {
        this.setHoverIndex(previousGroup.range[1] - 1);
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      consumeKeyEvent(event);
      const group = this.#menuState.groups.find(
        (candidate) =>
          this.#hoverIndex >= candidate.range[0] && this.#hoverIndex < candidate.range[1]
      );
      if (!group) {
        return;
      }

      const nextGroup = this.#menuState.groups[this.#menuState.groups.indexOf(group) + 1];
      if (nextGroup) {
        this.setHoverIndex(nextGroup.range[0]);
      }
      return;
    }

    if (event.key === 'Enter') {
      consumeKeyEvent(event);
      const index = this.#hoverIndex;
      this.hide();
      queueMicrotask(() => {
        this.runAtIndex(index, { hideMenu: false });
      });
    }
  };

  private handleWindowResize = () => {
    if (this.#content.dataset.show === 'true') {
      this.position();
    }
  };
}

export function createSlashMenuPlugin() {
  const api: SlashMenuAPI = {
    show: () => {},
    hide: () => {}
  };

  const plugin = new Plugin({
    key: new PluginKey('NOTEPAD_SLASH_MENU'),
    view: (view) => new SlashMenuView(view, api)
  });

  return {
    plugin,
    api
  };
}
