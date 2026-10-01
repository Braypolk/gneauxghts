<script lang="ts">
  import { CalendarDays, CalendarCheck, Clock, CalendarClock, CalendarRange } from '@lucide/svelte';
  import { hiddenFloatingPanelStyle, positionFloatingPanel } from '$lib/ui/floatingPanel';
  import { editorFloatingReference } from './editorFloatingReference';
  import { blockTypeIcons } from '$lib/features/notepad/editor/blockTypes';
  import type { PaneSlashMenuModel } from '$lib/features/notepad/editor/slashMenu';
  import {
    getSlashMenuFloatingReference,
    slashMenuActivateGroupFromUi,
    slashMenuHandleKeydownFromUi,
    slashMenuHideFromUi,
    slashMenuPickFromUi,
    slashMenuSetHoverFromUi
  } from '$lib/features/notepad/editor/slashMenu';

  const insertCommandIcons: Record<string, typeof CalendarDays> = {
    date: CalendarDays,
    today: CalendarCheck,
    time: Clock,
    now: CalendarClock,
    due: CalendarRange
  };

  interface Props {
    menu: PaneSlashMenuModel;
    boundsElement: HTMLElement | null;
  }

  let { menu, boundsElement }: Props = $props();

  let bodyEl = $state<HTMLDivElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  let panelStyle = $state(hiddenFloatingPanelStyle);

  $effect(() => {
    const currentMenu = menu;
    const currentPanel = panelEl;
    if (!currentMenu.open || !currentPanel) {
      panelStyle = hiddenFloatingPanelStyle;
      return;
    }
    const reference = editorFloatingReference(
      currentMenu.view, currentMenu.anchorPos, getSlashMenuFloatingReference(currentMenu.view)
    );
    return positionFloatingPanel(reference, currentPanel, (style) => { panelStyle = style; }, {
      boundsElement,
      resize(availableHeight) {
        const chrome = (currentPanel.querySelector<HTMLElement>('.slash-tabs')?.offsetHeight ?? 0) + 12;
        const body = currentPanel.querySelector<HTMLElement>('.slash-menu-body');
        if (body) body.style.maxHeight = `${Math.max(0, availableHeight - chrome)}px`;
      }
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
                {@const InsertIcon = insertCommandIcons[item.id]}
                <li
                  data-slash-index={item.index}
                  class="slash-item"
                  class:slash-item--hover={item.index === menu.hoverIndex}
                  onpointerenter={() => slashMenuSetHoverFromUi(menu.view, item.index)}
                  onpointerdown={(e) => e.preventDefault()}
                  onpointerup={() => slashMenuPickFromUi(menu.view, item.index)}
                >
                  <span class="slash-item-icon" aria-hidden="true">
                    {#if InsertIcon}
                      <InsertIcon strokeWidth={1.8} />
                    {:else}
                      {@html blockTypeIcons[item.id] ?? ''}
                    {/if}
                  </span>
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

  .slash-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 1.125rem;
    color: inherit;
  }

  .slash-item-icon :global(svg) {
    display: block;
    width: 1.125rem;
    height: 1.125rem;
  }

  .slash-item-label {
    flex: 1;
    min-width: 0;
  }
</style>
