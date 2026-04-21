<script lang="ts">
  import * as floatingUi from '@floating-ui/dom';
  import type { VirtualElement } from '@floating-ui/dom';
  import type { EditorView } from '@codemirror/view';
  import { blockTypeIcons } from '$lib/features/notepad/editor/blockTypes';
  import type { SlashMenuGroupWithItems } from '$lib/features/notepad/editor/slashMenu';
  import {
    getSlashMenuFloatingReference,
    slashMenuActivateGroupFromUi,
    slashMenuHandleKeydownFromUi,
    slashMenuHideFromUi,
    slashMenuPickFromUi,
    slashMenuSetHoverFromUi
  } from '$lib/features/notepad/editor/slashMenu';

  export type PaneSlashMenuModel =
    | { open: false }
    | {
        open: true;
        view: EditorView;
        anchorPos: number;
        groups: SlashMenuGroupWithItems[];
        hoverIndex: number;
      };

  interface Props {
    menu: PaneSlashMenuModel;
    boundsElement: HTMLElement | null;
  }

  let { menu, boundsElement }: Props = $props();

  let bodyEl = $state<HTMLDivElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  let panelStyle = $state('position: fixed; left: 0; top: 0; visibility: hidden;');

  function buildCoordsSlashMenuReference(view: EditorView, anchorPos: number): VirtualElement {
    return {
      getBoundingClientRect() {
        const coords =
          view.coordsAtPos(anchorPos) ??
          view.coordsAtPos(Math.max(0, Math.min(anchorPos, view.state.doc.length)));
        if (!coords) {
          return new DOMRect(0, 0, 1, 1);
        }
        const width = Math.max(1, coords.right - coords.left);
        const height = Math.max(1, coords.bottom - coords.top);
        return {
          x: coords.left,
          y: coords.top,
          left: coords.left,
          top: coords.top,
          right: coords.left + width,
          bottom: coords.top + height,
          width,
          height
        };
      }
    };
  }

  function getSlashMenuPositionReference(view: EditorView, anchorPos: number): VirtualElement {
    const handle = getSlashMenuFloatingReference(view);
    if (handle) {
      return {
        getBoundingClientRect: () => {
          const r = handle.getBoundingClientRect();
          if (r.width < 0.5 || r.height < 0.5) {
            return buildCoordsSlashMenuReference(view, anchorPos).getBoundingClientRect();
          }
          return r;
        }
      };
    }
    return buildCoordsSlashMenuReference(view, anchorPos);
  }

  async function updatePosition() {
    if (!menu.open || !panelEl) {
      panelStyle = 'position: fixed; left: 0; top: 0; visibility: hidden;';
      return;
    }

    const view = menu.view;
    const anchorPos = menu.anchorPos;
    const reference = getSlashMenuPositionReference(view, anchorPos);
    const boundary = boundsElement ?? undefined;

    const { x, y } = await floatingUi.computePosition(reference, panelEl, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [
        floatingUi.offset(10),
        floatingUi.flip({
          fallbackPlacements: ['top-start', 'bottom-end', 'top-end'],
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
            const tabs = floating.querySelector<HTMLElement>('.slash-tabs');
            const chrome = (tabs?.offsetHeight ?? 0) + 12;
            const forBody = Math.max(120, Math.floor(availableHeight - chrome));
            const body = floating.querySelector<HTMLElement>('.slash-menu-body');
            if (body) {
              body.style.maxHeight = `${forBody}px`;
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
    const anchorPos = currentMenu.anchorPos;
    const reference = getSlashMenuPositionReference(view, anchorPos);

    void updatePosition();

    return floatingUi.autoUpdate(reference, currentPanel, () => {
      void updatePosition();
    });
  });

  $effect(() => {
    if (!menu.open || !bodyEl) {
      return;
    }
    const row = bodyEl.querySelector<HTMLElement>(`[data-slash-index="${menu.hoverIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  });

  function handleWindowKeydownCapture(event: KeyboardEvent) {
    if (!menu.open) {
      return;
    }
    slashMenuHandleKeydownFromUi(menu.view, event);
  }
</script>

<svelte:window onkeydowncapture={handleWindowKeydownCapture} />

{#if menu.open}
  <div class="slash-root fixed inset-0 z-40" aria-hidden="false">
    <div
      class="slash-backdrop"
      role="presentation"
      onpointerdown={(e) => {
        e.preventDefault();
        slashMenuHideFromUi(menu.view);
      }}
    ></div>
    <div
      bind:this={panelEl}
      class="slash-panel pointer-events-auto"
      style={panelStyle}
      role="presentation"
    >
      <nav class="slash-tabs" aria-label="Block type groups">
        <ul>
          {#each menu.groups as group (group.key)}
            <li>
              <button
                type="button"
                class="slash-tab"
                class:slash-tab--selected={menu.hoverIndex >= group.range[0] &&
                  menu.hoverIndex < group.range[1]}
                onclick={() => slashMenuActivateGroupFromUi(menu.view, group.key)}
              >
                {group.label}
              </button>
            </li>
          {/each}
        </ul>
      </nav>
      <div bind:this={bodyEl} class="slash-menu-body">
        {#each menu.groups as group (group.key)}
          <section class="slash-group">
            <h6 class="slash-group-title">{group.label}</h6>
            <ul class="slash-items">
              {#each group.items as item (item.index)}
                <li
                  data-slash-index={item.index}
                  class="slash-item"
                  class:slash-item--hover={item.index === menu.hoverIndex}
                  onpointerenter={() => slashMenuSetHoverFromUi(menu.view, item.index)}
                  onpointerdown={(e) => e.preventDefault()}
                  onpointerup={() => slashMenuPickFromUi(menu.view, item.index)}
                >
                  <span class="slash-item-icon" aria-hidden="true"
                    >{@html blockTypeIcons[item.id] ?? ''}</span
                  >
                  <span class="slash-item-label">{item.label}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .slash-root {
    contain: layout style;
    pointer-events: auto;
  }

  .slash-backdrop {
    position: fixed;
    inset: 0;
    z-index: 41;
    pointer-events: auto;
  }

  .slash-panel {
    z-index: 60;
    width: min(26rem, calc(100vw - 2rem));
    border-radius: 1rem;
    border: 1px solid color-mix(in oklab, var(--border) 84%, var(--foreground) 16%);
    background: color-mix(in oklab, var(--card) 94%, var(--background));
    box-shadow: 0 16px 40px -28px color-mix(in oklab, var(--foreground) 42%, transparent);
    overflow: hidden;
  }

  .slash-tabs {
    border-bottom: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--muted) 66%, var(--background));
  }

  .slash-tabs ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0;
    padding: 0.4rem 0.5rem;
    list-style: none;
  }

  .slash-tab {
    margin: 0;
    padding: 0.35rem 0.65rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted-foreground);
    cursor: pointer;
  }

  .slash-tab--selected {
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    color: var(--foreground);
  }

  .slash-menu-body {
    max-height: min(420px, calc(100vh - 2rem));
    overflow-y: auto;
    padding: 0.45rem;
  }

  .slash-group {
    margin-bottom: 0.75rem;
  }

  .slash-group:last-child {
    margin-bottom: 0;
  }

  .slash-group-title {
    margin: 0 0 0.35rem;
    padding: 0 0.35rem;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .slash-items {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .slash-item {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.7rem;
    border-radius: 0.85rem;
    color: var(--foreground);
    cursor: pointer;
  }

  .slash-item--hover {
    background: color-mix(in oklab, var(--accent) 88%, var(--background));
  }

  .slash-item-icon :global(svg) {
    display: block;
    width: 1.35rem;
    height: 1.35rem;
    opacity: 0.92;
  }

  .slash-item-label {
    flex: 1;
    min-width: 0;
  }
</style>
