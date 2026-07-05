<script lang="ts">
  import * as floatingUi from '@floating-ui/dom';
  import type { VirtualElement } from '@floating-ui/dom';
  import type { EditorView } from '@codemirror/view';
  import { blockTypeIcons } from '$lib/features/notepad/editor/blockTypes';
  import {
    inlineFormatActions,
    inlineFormatIcons,
    getInlineFormatShortcutLabel,
    type InlineFormatId
  } from '$lib/features/notepad/editor/inlineFormatting';
  import type { PaneSelectionMenuModel } from '$lib/features/notepad/editor/selectionMenu';
  import {
    selectionMenuActivateGroupFromUi,
    selectionMenuApplyInlineFromUi,
    selectionMenuHandleKeydownFromUi,
    selectionMenuPickBlockFromUi,
    selectionMenuSetHoverFromUi,
    selectionMenuToggleBlockPanelFromUi
  } from '$lib/features/notepad/editor/selectionMenu';

  interface Props {
    menu: PaneSelectionMenuModel;
    boundsElement: HTMLElement | null;
  }

  let { menu, boundsElement }: Props = $props();

  let bodyEl = $state<HTMLDivElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  let panelStyle = $state('position: fixed; left: 0; top: 0; visibility: hidden;');

  function buildSelectionReference(view: EditorView, from: number, to: number): VirtualElement {
    return {
      getBoundingClientRect() {
        const start =
          view.coordsAtPos(from) ??
          view.coordsAtPos(Math.max(0, Math.min(from, view.state.doc.length)));
        const end =
          view.coordsAtPos(to) ??
          view.coordsAtPos(Math.max(0, Math.min(to, view.state.doc.length)));
        if (!start || !end) {
          return new DOMRect(0, 0, 1, 1);
        }

        const left = Math.min(start.left, end.left);
        const right = Math.max(start.right, end.right);
        const top = Math.min(start.top, end.top);
        const bottom = Math.max(start.bottom, end.bottom);
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);

        return {
          x: left,
          y: top,
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height
        };
      }
    };
  }

  async function updatePosition() {
    if (!menu.open || !panelEl) {
      panelStyle = 'position: fixed; left: 0; top: 0; visibility: hidden;';
      return;
    }

    const view = menu.view;
    const reference = buildSelectionReference(view, menu.selectionFrom, menu.selectionTo);
    const boundary = boundsElement ?? undefined;

    const { x, y } = await floatingUi.computePosition(reference, panelEl, {
      strategy: 'fixed',
      placement: 'top',
      middleware: [
        floatingUi.offset(10),
        floatingUi.flip({
          fallbackPlacements: ['bottom', 'top-start', 'bottom-start', 'top-end', 'bottom-end'],
          padding: 16,
          ...(boundary ? { boundary } : {})
        }),
        floatingUi.shift({
          padding: 16,
          ...(boundary ? { boundary } : {})
        }),
        floatingUi.size({
          padding: 16,
          ...(boundary ? { boundary } : {}),
          apply({ availableHeight, elements }) {
            const floating = elements.floating;
            const blockPanel = floating.querySelector<HTMLElement>('.selection-block-panel');
            const toolbar = floating.querySelector<HTMLElement>('.selection-toolbar');
            const chrome = (toolbar?.offsetHeight ?? 0) + 8;
            const forBody = Math.max(120, Math.floor(availableHeight - chrome));
            if (blockPanel) {
              blockPanel.style.maxHeight = `${forBody}px`;
            } else {
              floating.style.maxHeight = `${Math.max(120, Math.floor(availableHeight))}px`;
            }
          }
        })
      ]
    });

    panelStyle = `position: fixed; left: ${Math.round(x)}px; top: ${Math.round(y)}px; visibility: visible;`;
  }

  $effect(() => {
    const isOpen = menu.open;
    const currentPanel = panelEl;
    const currentMenu = menu;

    if (!isOpen || !currentPanel || currentMenu.open === false) {
      panelStyle = 'position: fixed; left: 0; top: 0; visibility: hidden;';
      return;
    }

    const view = currentMenu.view;
    const reference = buildSelectionReference(
      view,
      currentMenu.selectionFrom,
      currentMenu.selectionTo
    );

    void updatePosition();

    return floatingUi.autoUpdate(reference, currentPanel, () => {
      void updatePosition();
    });
  });

  $effect(() => {
    if (!menu.open || !bodyEl || !menu.blockPanelOpen) {
      return;
    }
    const row = bodyEl.querySelector<HTMLElement>(`[data-selection-index="${menu.hoverIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  });

  function handleWindowKeydownCapture(event: KeyboardEvent) {
    if (!menu.open) {
      return;
    }
    selectionMenuHandleKeydownFromUi(menu.view, event);
  }

  function handleInlineAction(id: InlineFormatId) {
    if (!menu.open) {
      return;
    }
    selectionMenuApplyInlineFromUi(menu.view, id);
  }
</script>

<svelte:window onkeydowncapture={handleWindowKeydownCapture} />

{#if menu.open}
  <div
    bind:this={panelEl}
    class="selection-panel pointer-events-auto"
    style={panelStyle}
    role="toolbar"
    tabindex="-1"
    aria-label="Text formatting"
    onpointerdown={(event) => event.preventDefault()}
  >
    <div class="selection-toolbar">
      {#each inlineFormatActions as action (action.id)}
        {@const shortcutLabel = getInlineFormatShortcutLabel(action.id)}
        <button
          type="button"
          class="selection-action"
          class:selection-action--active={menu.activeInlineFormats.includes(action.id)}
          title={shortcutLabel ? `${action.label} (${shortcutLabel})` : action.label}
          aria-label={action.label}
          aria-pressed={menu.activeInlineFormats.includes(action.id)}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => handleInlineAction(action.id)}
        >
          <span class="selection-action-icon" aria-hidden="true"
            >{@html inlineFormatIcons[action.id]}</span
          >
        </button>
      {/each}

      <span class="selection-divider" aria-hidden="true"></span>

      <button
        type="button"
        class="selection-action selection-action--turn-into"
        class:selection-action--active={menu.blockPanelOpen}
        aria-expanded={menu.blockPanelOpen}
        aria-controls="selection-block-panel"
        aria-label="Turn into block type"
        onpointerdown={(event) => event.preventDefault()}
        onclick={() => selectionMenuToggleBlockPanelFromUi(menu.view)}
      >
        <span class="selection-turn-into-label">Turn into</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class:selection-chevron--open={menu.blockPanelOpen}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
    </div>

    {#if menu.blockPanelOpen}
      <div id="selection-block-panel" class="selection-block-panel">
        <nav class="selection-tabs" aria-label="Block type groups">
          <ul>
            {#each menu.groups as group (group.key)}
              <li>
                <button
                  type="button"
                  class="selection-tab"
                  class:selection-tab--selected={menu.hoverIndex >= group.range[0] &&
                    menu.hoverIndex < group.range[1]}
                  onclick={() => selectionMenuActivateGroupFromUi(menu.view, group.key)}
                >
                  {group.label}
                </button>
              </li>
            {/each}
          </ul>
        </nav>
        <div bind:this={bodyEl} class="selection-menu-body">
          {#each menu.groups as group (group.key)}
            <section class="selection-group">
              <h6 class="selection-group-title">{group.label}</h6>
              <ul class="selection-items">
                {#each group.items as item (item.index)}
                  <li
                    data-selection-index={item.index}
                    class="selection-item"
                    class:selection-item--hover={item.index === menu.hoverIndex}
                    onpointerenter={() => selectionMenuSetHoverFromUi(menu.view, item.index)}
                    onpointerdown={(event) => event.preventDefault()}
                    onpointerup={() => selectionMenuPickBlockFromUi(menu.view, item.index)}
                  >
                    <span class="selection-item-icon" aria-hidden="true"
                      >{@html blockTypeIcons[item.id] ?? ''}</span
                    >
                    <span class="selection-item-label">{item.label}</span>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .selection-panel {
    z-index: 55;
    width: max-content;
    max-width: min(26rem, calc(100vw - 2rem));
    border-radius: 1.1rem;
    border: 1px solid color-mix(in oklab, var(--border) 84%, var(--foreground) 16%);
    background: color-mix(in oklab, var(--card) 94%, var(--background));
    box-shadow:
      0 1px 2px 0 hsl(0 0% 0% / 0.09),
      0 8px 10px -1px hsl(0 0% 0% / 0.18);
    overflow: hidden;
  }

  .selection-toolbar {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.3rem;
  }

  .selection-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.45rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--foreground);
    cursor: pointer;
    transition: background-color 150ms ease;
  }

  .selection-action:hover,
  .selection-action:focus-visible {
    background: color-mix(in oklab, var(--accent) 72%, var(--background));
    outline: none;
  }

  .selection-action--active,
  .selection-action--turn-into.selection-action--active {
    background: color-mix(in oklab, var(--accent) 88%, var(--background));
  }

  .selection-action--active .selection-action-icon :global(svg) {
    opacity: 1;
  }

  .selection-action--turn-into {
    gap: 0.25rem;
    padding-inline: 0.55rem 0.4rem;
    margin-inline-start: 0.1rem;
  }

  .selection-action-icon :global(svg) {
    display: block;
    width: 1rem;
    height: 1rem;
    opacity: 0.92;
  }

  .selection-turn-into-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--foreground);
    white-space: nowrap;
  }

  .selection-chevron--open {
    transform: rotate(180deg);
  }

  .selection-divider {
    width: 1px;
    align-self: stretch;
    margin: 0.25rem 0.15rem;
    background: color-mix(in oklab, var(--border) 84%, transparent);
  }

  .selection-block-panel {
    border-top: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    overflow: hidden;
  }

  .selection-tabs {
    border-bottom: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--muted) 66%, var(--background));
  }

  .selection-tabs ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0;
    padding: 0.35rem 0.45rem;
    list-style: none;
  }

  .selection-tab {
    margin: 0;
    padding: 0.3rem 0.6rem;
    border: none;
    border-radius: 9999px;
    background: transparent;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted-foreground);
    cursor: pointer;
  }

  .selection-tab--selected {
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    color: var(--foreground);
  }

  .selection-menu-body {
    max-height: min(320px, calc(100vh - 6rem));
    overflow-y: auto;
    padding: 0.4rem;
  }

  .selection-group {
    margin-bottom: 0.65rem;
  }

  .selection-group:last-child {
    margin-bottom: 0;
  }

  .selection-group-title {
    margin: 0 0 0.3rem;
    padding: 0 0.3rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .selection-items {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .selection-item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.55rem 0.65rem;
    border-radius: 1.1rem;
    color: var(--foreground);
    cursor: pointer;
  }

  .selection-item--hover {
    background: color-mix(in oklab, var(--accent) 88%, var(--background));
  }

  .selection-item-icon :global(svg) {
    display: block;
    width: 1.25rem;
    height: 1.25rem;
    opacity: 0.92;
  }

  .selection-item-label {
    flex: 1;
    min-width: 0;
    font-size: 0.8125rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .selection-action {
      transition: none;
    }

    .selection-chevron--open {
      transform: none;
    }
  }
</style>
