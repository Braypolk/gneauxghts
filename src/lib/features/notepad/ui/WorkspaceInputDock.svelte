<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { ArrowUp, MessagesSquare, Network, Search, Square } from '@lucide/svelte';
  import MorphingContainers, { type ContainerGroupPresentation, type ContainerPresentation, type MorphingContainerItem } from '#lib/ui/morphing-containers/MorphingContainers.svelte';
  import { ramp } from '#lib/ui/morphing-containers/motion.js';
  import type { DockSearchPresentation, DockActionPresentation } from './workspaceDockPresentation';
  import { searchExpansionStyles } from '#lib/ui/search/searchMotion.js';
  import './workspaceDockMotion.css';

  let { search, relatedContent, overlay, hasChat = false, mode = 'search', chatSlot = $bindable(null),
    actionPresentation = $bindable({ running: false, progress: 1 }), related, onSearch, onChat }: {
    search: Snippet<[DockSearchPresentation, HTMLElement | null]>;
    relatedContent: Snippet;
    overlay?: Snippet;
    hasChat?: boolean;
    related?: { active: boolean; available: boolean; popupId: string; onOpen: () => void; onDismiss: () => void; onBlur: () => void };
    mode?: 'search' | 'chat';
    chatSlot?: HTMLDivElement | null;
    actionPresentation?: DockActionPresentation;
    onSearch: () => void;
    onChat: () => void;
  } = $props();

  let node = $state<HTMLDivElement | null>(null);
  let presentation = $state<ContainerGroupPresentation | null>(null);
  let layoutEndpoint = $state<{ id: number; left: number; width: number } | null>(null);
  let circle = $state(40);
  let fontSize = $state(16);
  let controlSize = $state(32);
  let width = $state(384);
  let gap = $state(12);
  let searchOpen = $state(false);
  let searchExpanded = $state(false);
  let sendSize = $state(29.6);
  let sendInset = $state(8.2);
  let searchIconInset = $state(28);
  let isStopAction = $state(false);
  let sendOpacity = $state(0.4);
  let capturedSearchActive = false;
  let capturedSearchExpanded = false;
  let previousTarget = '';
  const target = $derived(related?.active ? 'related' : hasChat && mode === 'chat' ? 'chat' : 'search');
  const running = $derived(!!presentation?.transition);
  const progress = $derived(presentation?.transition?.progress ?? 1);
  const searchHeight = $derived(presentation?.contentHeights.search ?? circle);
  const chatHeight = $derived(presentation?.contentHeights.chat ?? 76);
  const maxBodyWidth = $derived(52 * fontSize - ((related ? 1 : 0) + (hasChat ? 1 : 0)) * (circle + gap));
  const barWidth = $derived(hasChat ? maxBodyWidth : (target === 'related' || searchExpanded ? 42 : 24) * fontSize);
  const compactHeight = $derived(width <= 28 * fontSize ? circle + controlSize + 0.25 * fontSize : circle);
  const searchPresentation = $derived<DockSearchPresentation>({
    active: running && target !== 'search' ? capturedSearchActive : undefined,
    expanded: running && target !== 'search' ? capturedSearchExpanded : hasChat && mode === 'search' ? true : undefined
  });
  const items = $derived<MorphingContainerItem[]>([
    { id: 'search', label: related ? 'Search notes' : 'Expand search', state: target === 'search' ? searchOpen ? 'expanded' : 'compact' : 'icon',
      width: target === 'search' ? barWidth : undefined, height: searchHeight, iconInset: searchIconInset,
      icon: searchIcon, content: searchContent, class: 'dock-search-layer', toggleClass: 'dock-search-toggle', onActivate: onSearch },
    ...(related ? [{ id: 'related', label: 'Related notes', state: target === 'related' ? 'expanded' : 'icon',
      width: hasChat ? maxBodyWidth : 42 * fontSize, height: target === 'related' ? compactHeight : circle,
      iconEdge: 'end', icon: relatedIcon, content: relatedSurface, class: 'dock-related-layer', toggleClass: 'dock-related-toggle',
      disabled: !related.available, controls: related.popupId, onActivate: related.onOpen } satisfies MorphingContainerItem] : []),
    ...(hasChat ? [{ id: 'chat', label: 'Expand chat input', state: target === 'chat' ? 'expanded' : 'icon',
      width: maxBodyWidth, height: chatHeight, radius: 19.2, iconEdge: 'end', iconInset: sendInset + sendSize / 2, expandedIconSize: sendSize,
      icon: chatIcon, content: chatContent, class: 'dock-chat-layer', toggleClass: 'dock-chat-toggle', onActivate: onChat } satisfies MorphingContainerItem] : [])
  ]);
  const availableBarWidth = $derived(Math.max(circle, Math.min(width, 52 * fontSize) - (items.length - 1) * (circle + gap)));
  const collapsedBarWidth = $derived(Math.min(24 * fontSize, availableBarWidth));
  const expandedBarWidth = $derived(Math.min(42 * fontSize, availableBarWidth));
  const searchWidthMotion = $derived(!hasChat && target === 'search' && presentation?.transition?.fromId === 'search'
    && Math.abs(presentation.transition.origin.bodyWidth - Math.min(barWidth ?? availableBarWidth, availableBarWidth)) > 1);
  const searchWidthFraction = $derived(Math.max(0, Math.min(1,
    ((presentation?.geometry.bodyWidth ?? collapsedBarWidth) - collapsedBarWidth) / Math.max(1, expandedBarWidth - collapsedBarWidth))));
  const styles = $derived(`${searchExpansionStyles};--dock-search-width-fraction:${searchWidthFraction}fr;--morph-bottom-inset:var(--dock-circle-inset);--dock-gap:${gap}px;
    --dock-search-results-width:${hasChat ? availableBarWidth + 'px' : `min(42rem, ${availableBarWidth}px)`};
    --dock-search-text:${presentation?.textVisible && target === 'search' ? 1 : 0};--dock-chat-text:${presentation?.textVisible && target === 'chat' ? 1 : 0};
    --search-results-anchor-height:${compactHeight}px;--dock-composer-height:${chatHeight}px;--dock-send-opacity:${hasChat ? sendOpacity : 1};--dock-chat-glyph:${1 - ramp(0.3, 0.48, presentation?.geometry.icons.find(icon => icon.id === 'chat')?.selection ?? 0)};
    --dock-send-glyph:${ramp(0.52, 0.7, presentation?.geometry.icons.find(icon => icon.id === 'chat')?.selection ?? 0)};`);

  $effect.pre(() => {
    const next = target;
    untrack(() => {
      if (next !== previousTarget) {
        const shell = node?.querySelector<HTMLElement>('.shared-search-bar-shell');
        capturedSearchActive = shell?.dataset.searchActive === 'true';
        capturedSearchExpanded = shell?.dataset.searchExpanded === 'true';
        previousTarget = next;
      }
    });
  });
  $effect(() => {
    actionPresentation = { running, progress };
    const row = node?.closest<HTMLElement>('.search-dock-row');
    row?.style.setProperty('--dock-layout-body-height', `${presentation?.geometry.bodyHeight ?? circle}px`);
  });
  $effect(() => {
    const element = node;
    if (!element) return;
    const read = () => {
      const css = getComputedStyle(element);
      const shell = element.querySelector<HTMLElement>('.shared-search-bar-shell');
      const send = element.querySelector<HTMLButtonElement>('.chat-send-button');
      const composer = send?.closest<HTMLElement>('.chat-composer-surface');
      fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const control = css.getPropertyValue('--search-control-size').trim();
      controlSize = parseFloat(control) * (control.endsWith('rem') ? fontSize : 1) || 32;
      width = element.clientWidth;
      circle = shell ? parseFloat(getComputedStyle(shell).minHeight) || 40 : 40;
      gap = parseFloat(css.getPropertyValue('--discovery-gap')) * fontSize || (width < 640 ? 6 : 12);
      searchOpen = shell?.dataset.searchOpen === 'true';
      // Related uses the same popup lifetime but must retain Search's outgoing layout.
      if (!related?.active) searchExpanded = shell?.dataset.searchLayoutExpanded === 'true';
      sendSize = send?.getBoundingClientRect().width || 29.6;
      sendInset = send && composer ? composer.getBoundingClientRect().right - send.getBoundingClientRect().right : 8.2;
      isStopAction = send?.dataset.chatAction === 'stop';
      sendOpacity = send && !send.disabled ? 1 : 0.4;
      const icon = shell?.querySelector('.shared-search-input-layer > svg')?.getBoundingClientRect();
      if (icon && shell) searchIconInset = icon.left + icon.width / 2 - shell.getBoundingClientRect().left;
    };
    untrack(read);
    const mutations = new MutationObserver(read);
    mutations.observe(element, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-search-expanded', 'data-search-layout-expanded', 'data-search-open', 'disabled', 'data-chat-action'] });
    const size = new ResizeObserver(read); size.observe(element);
    const workspace = element.closest('.notepad-shell');
    const layoutReady = (event: Event) => {
      layoutEndpoint = (event as CustomEvent<{ id: number; left: number; width: number } | null>).detail;
      read();
    };
    workspace?.addEventListener('workspace-pane-layout-ready', layoutReady);
    return () => { mutations.disconnect(); size.disconnect(); workspace?.removeEventListener('workspace-pane-layout-ready', layoutReady);
      element.closest<HTMLElement>('.search-dock-row')?.style.removeProperty('--dock-layout-body-height'); };
  });
</script>

{#snippet searchIcon()}<Search class="h-4 w-4" />{/snippet}
{#snippet relatedIcon()}<Network class="dock-related-icon h-4 w-4" />{/snippet}
{#snippet chatIcon(view: ContainerPresentation)}
  <MessagesSquare class="dock-chat-icon h-5 w-5" style={`opacity:${1 - ramp(0.3, 0.48, view.selection)}`} />
  {#if isStopAction}<Square class="dock-send-icon h-3.5 w-3.5 fill-current" style={`opacity:${ramp(0.52, 0.7, view.selection) * sendOpacity}`} />
  {:else}<ArrowUp class="dock-send-icon h-4 w-4" style={`opacity:${ramp(0.52, 0.7, view.selection) * sendOpacity}`} />{/if}
{/snippet}
{#snippet searchContent()}{@render search(searchPresentation, node)}{/snippet}
{#snippet relatedSurface()}<div class="related-dock-content" style:min-height={`${compactHeight}px`}>{@render relatedContent()}</div>{/snippet}
{#snippet chatContent()}<div bind:this={chatSlot} class="workspace-chat-slot"></div>{/snippet}

<MorphingContainers {items} circleSize={circle} {gap} alignment="body" bind:element={node} bind:presentation {layoutEndpoint} {overlay}
  class="workspace-input-dock" style={styles} data-secondary={target === 'related' || !hasChat ? 'related' : 'chat'}
  data-input-dock-mode={target} data-dock-state={target === 'related' ? 'related-input' : target === 'chat' ? 'chat-input' : hasChat ? 'chat-search' : related ? 'related-search' : 'editor-search'}
  data-search-width-motion={searchWidthMotion || undefined}
  data-popup-delay={presentation?.transition?.fromId === 'chat' || undefined}
  data-dock-phase={running ? 'exchange' : 'settled'}
  data-dock-reading-clearance={hasChat ? Math.max(chatHeight, searchHeight) : undefined}
  data-dock-clearance={running ? Math.max(hasChat || presentation?.transition?.origin.icons.some(icon => icon.id === 'chat') ? chatHeight : 0, searchHeight, presentation?.geometry.bodyHeight ?? 0, presentation?.transition?.origin.bodyHeight ?? 0) : undefined}
  transitionContext={() => ({ coordinated: !!node?.closest('[data-pane-layout-change]'),
    immediate: !!node?.closest('[data-window-resizing]') })}
  onfocusout={(event) => {
    if (!related?.active || event.relatedTarget instanceof Node && node?.contains(event.relatedTarget)) return;
    void tick().then(() => { if (related?.active && !node?.contains(document.activeElement)) related.onBlur(); });
  }}
  onkeydown={(event) => { if (related?.active && event.key === 'Escape') { event.preventDefault(); related.onDismiss(); } }}
/>
