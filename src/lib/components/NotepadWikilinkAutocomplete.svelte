<script lang="ts">
  import {
    autoUpdate,
    computePosition,
    flip,
    offset,
    shift,
    size,
    type VirtualElement
  } from '@floating-ui/dom';
  import { tick } from 'svelte';
  import type { ActiveWikilink } from './notepadWikilinks';
  import type { NoteLinkSuggestion } from './notepadTypes';

  interface Props {
    active: boolean;
    activeWikilink: ActiveWikilink | null;
    suggestions: NoteLinkSuggestion[];
    selectedIndex: number;
    onSelect: (suggestion: NoteLinkSuggestion) => void;
  }

  let {
    active,
    activeWikilink,
    suggestions,
    selectedIndex,
    onSelect
  }: Props = $props();

  let popupElement = $state<HTMLDivElement | null>(null);
  let popupStyle = $state('position: fixed; left: 0; top: 0; visibility: hidden;');

  function buildWikilinkReference(wikilink: ActiveWikilink): VirtualElement {
    return {
      getBoundingClientRect() {
        const width = Math.max(1, 0);
        const height = Math.max(1, wikilink.bottom - wikilink.top);

        return {
          x: wikilink.left,
          y: wikilink.top,
          left: wikilink.left,
          top: wikilink.top,
          right: wikilink.left + width,
          bottom: wikilink.top + height,
          width,
          height
        };
      }
    };
  }

  async function updatePosition() {
    if (!activeWikilink || !popupElement) {
      popupStyle = 'position: fixed; left: 0; top: 0; visibility: hidden;';
      return;
    }

    const { x, y, middlewareData } = await computePosition(
      buildWikilinkReference(activeWikilink),
      popupElement,
      {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(10),
          flip({
            fallbackPlacements: ['top-start', 'bottom-end', 'top-end'],
            padding: 16
          }),
          shift({
            padding: 16
          }),
          size({
            padding: 16,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(120, Math.floor(availableHeight))}px`;
            }
          })
        ]
      }
    );

    const maxHeight = popupElement.style.maxHeight || 'none';
    const visibility =
      middlewareData.hide?.referenceHidden || middlewareData.hide?.escaped ? 'hidden' : 'visible';

    popupStyle = `position: fixed; left: ${Math.round(x)}px; top: ${Math.round(y)}px; max-height: ${maxHeight}; visibility: ${visibility};`;
  }

  $effect(() => {
    const isActive = active;
    const currentActiveWikilink = activeWikilink;
    const currentPopupElement = popupElement;

    if (!isActive || !currentActiveWikilink || !currentPopupElement) {
      popupStyle = 'position: fixed; left: 0; top: 0; visibility: hidden;';
      return;
    }

    void updatePosition();

    return autoUpdate(buildWikilinkReference(currentActiveWikilink), currentPopupElement, () => {
      void updatePosition();
    });
  });

  $effect(() => {
    const isActive = active;
    const currentSelectedIndex = selectedIndex;
    const currentSuggestions = suggestions;
    const currentPopupElement = popupElement;

    if (!isActive || currentSuggestions.length === 0 || !currentPopupElement) {
      return;
    }

    currentSelectedIndex;

    void tick().then(() => {
      requestAnimationFrame(() => {
        const activeItem = currentPopupElement.querySelector<HTMLElement>(
          '[data-wikilink-suggestion-active="true"]'
        );
        activeItem?.scrollIntoView({ block: 'nearest' });
      });
    });
  });
</script>

{#if active && activeWikilink}
  <div
    bind:this={popupElement}
    class="fixed z-30 flex min-w-72 max-w-md flex-col overflow-hidden rounded-[1.25rem] border border-border bg-popover/95 shadow-xl backdrop-blur-md pointer-events-auto"
    style={popupStyle}
  >
    {#if suggestions.length === 0}
      <div class="px-4 py-3 text-sm text-muted-foreground">No matching notes or sections.</div>
    {:else}
      <div class="border-b border-border/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Wikilinks
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1.5">
        {#each suggestions as suggestion, index (`${suggestion.kind}-${suggestion.value}-${index}`)}
          <button
            type="button"
            data-wikilink-suggestion-active={index === selectedIndex ? 'true' : 'false'}
            class={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
              index === selectedIndex ? 'bg-accent' : 'hover:bg-accent'
            }`}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => onSelect(suggestion)}
          >
            <span class="mt-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {suggestion.kind}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-popover-foreground">
                {suggestion.label}
              </span>
              <span class="block truncate pt-0.5 text-xs text-muted-foreground">{suggestion.detail}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
