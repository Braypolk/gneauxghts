import type { Ctx } from '@milkdown/kit/ctx';
import { $ctx } from '@milkdown/kit/utils';
import type { PluginView, Selection } from '@milkdown/kit/prose/state';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { SlashProvider, slashFactory } from '@milkdown/kit/plugin/slash';
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

interface SlashMenuAPI {
  show: (pos: number) => void;
  hide: () => void;
}

export const slashMenu = slashFactory('NOTEPAD_SLASH_MENU');
export const slashMenuAPI = $ctx<SlashMenuAPI, 'slashMenuAPI'>(
  {
    show: () => {},
    hide: () => {}
  },
  'slashMenuAPI'
);

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

function isSelectionAtEndOfNode(selection: Selection) {
  if (!(selection instanceof TextSelection)) return false;

  const { $head } = selection;
  return $head.parentOffset === $head.parent.content.size;
}

function runSlashMenuSelection(ctx: Ctx, view: EditorView, optionId: string) {
  if (!slashMenuOptionIds.has(optionId)) {
    return;
  }

  applyBlockTypeSelection(ctx, view, optionId, { clearCurrentBlock: true });
}

class SlashMenuView implements PluginView {
  readonly #ctx: Ctx;
  readonly #content: HTMLElement;
  readonly #provider: SlashProvider;
  #filter = '';
  #hoverIndex = 0;
  #view: EditorView;
  #programmaticPos: number | null = null;
  #menuState: SlashMenuState = getSlashMenuState();

  constructor(ctx: Ctx, view: EditorView) {
    this.#ctx = ctx;
    this.#view = view;

    const content = document.createElement('div');
    content.className = 'milkdown-slash-menu';
    content.dataset.show = 'false';
    content.addEventListener('pointerdown', this.handlePointerDown);
    content.addEventListener('pointermove', this.handlePointerMove);
    content.addEventListener('pointerup', this.handlePointerUp);
    this.#content = content;

    this.#provider = new SlashProvider({
      content,
      debounce: 20,
      shouldShow: (nextView) => {
        if (isInCodeContext(nextView.state.selection) || isInList(nextView.state.selection)) {
          return false;
        }

        const currentText = this.#provider.getContent(nextView, (node) =>
          node.type.name === 'paragraph' || node.type.name === 'heading'
        );

        if (currentText == null || !isSelectionAtEndOfNode(nextView.state.selection)) {
          return false;
        }

        this.#filter = currentText.startsWith('/') ? currentText.slice(1) : currentText;
        this.#menuState = getSlashMenuState(this.#filter);
        this.#hoverIndex = Math.min(this.#hoverIndex, Math.max(0, this.#menuState.size - 1));

        const pos = this.#programmaticPos;
        if (typeof pos === 'number') {
          const maxSize = nextView.state.doc.nodeSize - 2;
          const validPos = Math.min(pos, maxSize);
          if (
            nextView.state.doc.resolve(validPos).node() !==
            nextView.state.doc.resolve(nextView.state.selection.from).node()
          ) {
            this.#programmaticPos = null;
            return false;
          }

          return true;
        }

        return currentText.startsWith('/');
      },
      offset: 10
    });

    this.#provider.onShow = () => {
      this.render();
    };
    this.#provider.onHide = () => {
      this.#content.dataset.show = 'false';
    };

    ctx.set(slashMenuAPI.key, {
      show: (pos) => this.show(pos),
      hide: () => this.hide()
    });

    window.addEventListener('keydown', this.handleWindowKeydown, true);
    this.update(view);
  }

  update = (view: EditorView) => {
    this.#view = view;
    this.#provider.update(view);
    if (this.#content.dataset.show === 'true') {
      this.render();
    }
  };

  show = (pos: number) => {
    this.#programmaticPos = pos;
    this.#filter = '';
    this.#menuState = getSlashMenuState('');
    this.#hoverIndex = 0;
    this.#provider.update(this.#view);
    this.#provider.show();
    this.render();
  };

  hide = () => {
    this.#programmaticPos = null;
    this.#provider.hide();
  };

  destroy = () => {
    window.removeEventListener('keydown', this.handleWindowKeydown, true);
    this.#provider.destroy();
    this.#content.removeEventListener('pointerdown', this.handlePointerDown);
    this.#content.removeEventListener('pointermove', this.handlePointerMove);
    this.#content.removeEventListener('pointerup', this.handlePointerUp);
    this.#content.remove();
  };

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
                  class="${this.#hoverIndex >= group.range[0] && this.#hoverIndex < group.range[1] ? 'selected' : ''}"
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

  private runAtIndex(index: number) {
    const item = this.#menuState.groups
      .flatMap((group) => group.items)
      .find((candidate) => candidate.index === index);
    if (!item) {
      return;
    }

    runSlashMenuSelection(this.#ctx, this.#view, item.id);
    this.hide();
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
      event.preventDefault();
      this.hide();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.setHoverIndex(this.#hoverIndex + 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.setHoverIndex(this.#hoverIndex - 1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
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
      event.preventDefault();
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
      event.preventDefault();
      this.runAtIndex(this.#hoverIndex);
    }
  };
}

export function configureSlashMenu(ctx: Ctx) {
  ctx.set(slashMenu.key, {
    view: (view) => new SlashMenuView(ctx, view)
  });
}
