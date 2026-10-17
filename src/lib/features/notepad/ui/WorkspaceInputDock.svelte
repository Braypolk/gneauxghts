<script lang="ts">
  import { onDestroy, tick, untrack, type Snippet } from 'svelte';
  import { ArrowUp, MessagesSquare, Search, Square } from '@lucide/svelte';
  import WorkspaceDockSurface from './WorkspaceDockSurface.svelte';
  import WorkspaceDockMaterial from './WorkspaceDockMaterial.svelte';
  import {
    createWorkspaceDockMotion, transitionWorkspaceDock, workspaceDockGeometry,
    workspaceDockPhase, workspaceDockPresentation, type DockMeasure, type WorkspaceDockState,
    type DockSearchPresentation, type DockActionPresentation
  } from './workspaceDockMachine';
  import './workspaceDockMotion.css';

  let { search, hasChat = false, mode = 'search', chatSlot = $bindable(null),
    actionPresentation = $bindable({ running: false, progress: 1 }), onSearch, onChat }: {
    search: Snippet<[DockSearchPresentation]>;
    hasChat?: boolean;
    mode?: 'search' | 'chat';
    chatSlot?: HTMLDivElement | null;
    actionPresentation?: DockActionPresentation;
    onSearch: () => void;
    onChat: () => void;
  } = $props();

  const componentId = $props.id();
  const filterId = `${componentId}-dock-morph`;
  const target = $derived<WorkspaceDockState>(!hasChat ? 'editor-search' : mode === 'chat' ? 'chat-input' : 'chat-search');
  let motion = $state.raw(untrack(() => createWorkspaceDockMotion(target)));
  let node = $state<HTMLDivElement | null>(null);
  let searchHeight = $state(0);
  let chatHeight = $state(0);
  let measure = $state.raw<DockMeasure>({ width: 384, editorWidth: 384, searchHeight: 40, chatHeight: 76, gap: 12, sendSize: 29.6, sendInset: 8.2 });
  let paneLayoutActive = $state(false);
  let layoutLeft = $state(0);
  let actions = $state.raw<Array<{ left: number; width: number }>>([]);
  let layoutOrigin = $state.raw<{ measure: DockMeasure; left: number; actions: Array<{ left: number; width: number }> } | null>(null);
  type Geometry = ReturnType<typeof workspaceDockGeometry>;
  let geometryOrigin = $state.raw<Geometry | null>(null);
  let layoutDestination = $state.raw<{ id: number; left: number; width: number } | null>(null);
  let originSearchActive = $state(false);
  let originSearchExpanded = $state(false);
  let lastSearchActive = false;
  let isStopAction = $state(false);
  let sendOpacity = $state(0.4);
  let frame: number | undefined;
  let settling = $state<number | undefined>();
  let media: MediaQueryList | undefined;
  let readLayout: (() => void) | undefined;
  const progress = $derived(motion.transition?.progress ?? 1);
  const coordinatedLayout = $derived(!!motion.transition &&
    (paneLayoutActive || motion.transition.from === 'editor-search' || motion.transition.to === 'editor-search'));
  const renderMeasure = $derived.by(() => {
    const destination = { ...measure, searchBodyHeight: searchHeight || measure.searchHeight, chatHeight: chatHeight || measure.chatHeight };
    if (!motion.transition || !layoutOrigin || coordinatedLayout) return destination;
    const origin = layoutOrigin.measure;
    // Related/pane layout can change the dock's available width during entry.
    // Blend the measured coordinate spaces on the same animation clock.
    return { ...destination,
      width: origin.width + (destination.width - origin.width) * progress,
      editorWidth: origin.editorWidth + (destination.editorWidth - origin.editorWidth) * progress,
      chatHeight: origin.chatHeight + (destination.chatHeight - origin.chatHeight) * progress
    };
  });
  const virtualLeft = $derived(layoutLeft + (layoutOrigin && !coordinatedLayout ? (layoutOrigin.left - layoutLeft) * (1 - progress) : 0));
  const geometry = $derived.by(() => {
    const pose = workspaceDockGeometry(motion.pose, renderMeasure);
    if (coordinatedLayout && geometryOrigin) {
      // Follow measured world-space endpoints directly. Recomputing a pose
      // against the animated flex width would apply the motion twice and kink
      // when the dock crosses its max-width cap. A correlated pane event supplies
      // the final bounds before paint; until then keep the displayed origin.
      const endpoint = layoutDestination?.id === motion.transition?.id ? layoutDestination : null;
      const destination = endpoint ? workspaceDockGeometry(createWorkspaceDockMotion(target).pose,
        { ...renderMeasure, width: endpoint.width }) : geometryOrigin;
      const destinationLeft = endpoint?.left ?? 0;
      const interpolate = (field: 'bodyX' | 'searchCircleX' | 'rightShellX') =>
        geometryOrigin![field] + (destination[field] + destinationLeft - geometryOrigin![field]) * progress - layoutLeft;
      const originCenter = geometryOrigin.chatCircleX + geometryOrigin.rightSize / 2;
      const destinationCenter = destination.chatCircleX + destination.rightSize / 2 + destinationLeft;
      return { ...pose, bodyX: interpolate('bodyX'), searchCircleX: interpolate('searchCircleX'),
        rightShellX: interpolate('rightShellX'),
        bodyWidth: geometryOrigin.bodyWidth + (destination.bodyWidth - geometryOrigin.bodyWidth) * progress,
        chatCircleX: originCenter + (destinationCenter - originCenter) * progress - pose.rightSize / 2 - layoutLeft };
    }
    const offset = virtualLeft - layoutLeft;
    return { ...pose, bodyX: pose.bodyX + offset,
      searchCircleX: pose.searchCircleX + offset, chatCircleX: pose.chatCircleX + offset,
      rightShellX: pose.rightShellX + offset };
  });
  const phase = $derived(workspaceDockPhase(motion));
  const running = $derived(motion.transition !== null);
  const presentation = $derived(workspaceDockPresentation(motion));
  const bodyRadius = $derived(measure.searchHeight / 2 + (19.2 - measure.searchHeight / 2) * motion.pose.input);
  const searchPresentation = $derived<DockSearchPresentation>(running ? {
    // Preserve outgoing controls through their fade. Incoming search follows
    // its own focus state, so pane activation cannot flash idle controls.
    active: target === 'chat-input' ? originSearchActive : undefined,
    // Retain outgoing search widths through the fade. Incoming editor search
    // derives its width from focus and query state rather than forcing it open.
    expanded: target === 'editor-search' ? undefined : target === 'chat-input' ? originSearchExpanded : true
  } : { expanded: hasChat ? mode === 'search' : undefined });
  const styles = $derived([
    `--dock-editor-width:${renderMeasure.editorWidth}px`, `--dock-body-x:${geometry.bodyX}px`, `--dock-body-width:${geometry.bodyWidth}px`,
    `--dock-search-results-width:${hasChat ? `${geometry.bodyWidth}px` : `min(${renderMeasure.width}px, 42rem)`}`,
    `--dock-body-height:${geometry.bodyHeight}px`, `--dock-body-radius:${bodyRadius}px`,
    `--dock-search-x:${geometry.searchCircleX}px`, `--dock-search-glyph:16px`, `--dock-search-glyph-shift:${geometry.searchGlyphShift}px`, `--dock-search-size:${geometry.searchSize}px`,
    `--dock-chat-x:${geometry.chatCircleX}px`, `--dock-chat-size:${geometry.rightSize}px`,
    `--dock-search-opacity:1`, `--dock-chat-opacity:${presentation.rightVisibility}`,
    `--dock-inner-search-icon:0`, `--dock-search-text:${presentation.searchText}`,
    `--dock-chat-text:${presentation.chatText}`, `--dock-search-controls:${geometry.searchControls}`,
    `--dock-chat-controls:${geometry.chatControls}`, `--dock-text-shift:${geometry.textShift}px`, `--dock-text-push:${geometry.textPush}px`,
    `--dock-send-color:${geometry.sendAppearance * sendOpacity * 100}%`,
    `--dock-chat-glyph:${presentation.chatGlyph}`, `--dock-send-glyph:${presentation.sendGlyph}`,
    `--dock-send-opacity:${sendOpacity}`
  ].join(';'));

  // The sibling actions share the dock's coordinate interpolation. Pane and
  // Related layout can otherwise finish before the bar and intersect it.
  function projectedActions() {
    if (coordinatedLayout) return actions;
    return actions.map((action, index) => ({ ...action, left: action.left +
      ((layoutOrigin?.actions[index]?.left ?? action.left) - action.left) * (1 - progress) }));
  }
  $effect(() => {
    actionPresentation = { running, progress };
    const row = node?.parentElement;
    if (!coordinatedLayout) {
      row?.style.removeProperty('--dock-layout-reserved');
      row?.style.removeProperty('--dock-layout-balance');
    }
    const projected = projectedActions();
    projected.forEach((action, index) => row?.style.setProperty(
      `--dock-action-${index}-shift`, `${action.left - actions[index].left}px`));
  });

  function cancelFrame() { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; }
  function runFrames() {
    cancelFrame();
    const id = motion.transition?.id;
    if (id === undefined) return;
    const advance = (now: number) => {
      readLayout?.();
      motion = transitionWorkspaceDock(motion, { type: 'frame', id, now });
      if (motion.transition?.id === id) frame = requestAnimationFrame(advance);
      else {
        frame = undefined;
        settling = id;
        // Keep ordinary search CSS transitions suppressed while releasing the
        // projected margins. Otherwise the parent reaches its final position
        // while its children start a second transition from stale local bounds.
        void tick().then(async () => {
          if (motion.transition || settling !== id || !node?.isConnected) return;
          readLayout?.();
          await tick();
          node?.getBoundingClientRect();
          if (settling === id) settling = undefined;
        });
      }
    };
    frame = requestAnimationFrame(advance);
  }
  $effect.pre(() => {
    const next = target;
    untrack(() => {
      if (next !== motion.target) {
        const previous = geometry;
        geometryOrigin = { ...previous, bodyX: previous.bodyX + layoutLeft,
          searchCircleX: previous.searchCircleX + layoutLeft, chatCircleX: previous.chatCircleX + layoutLeft,
          rightShellX: previous.rightShellX + layoutLeft };
        layoutDestination = null;
        layoutOrigin = { measure: renderMeasure, left: virtualLeft, actions: projectedActions() };
        originSearchActive = lastSearchActive;
        originSearchExpanded = node?.querySelector<HTMLElement>('.shared-search-bar-shell')?.dataset.searchExpanded === 'true';
      }
      settling = undefined;
      motion = transitionWorkspaceDock(motion, { type: 'request', target: next, now: performance.now(),
        easing: node?.closest('[data-pane-layout-change]') ? 'editor' : undefined,
        immediate: media?.matches || (next === 'editor-search' || motion.target === 'editor-search') &&
          !!node?.closest('[data-window-resizing]') });
      runFrames();
    });
  });

  function observeDock(element: HTMLDivElement) {
    media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => {
      const row = element.parentElement;
      const card = element.closest<HTMLElement>('.notepad-workspace-card');
      if (coordinatedLayout && card) {
        const cardStyle = getComputedStyle(card);
        row?.style.setProperty('--dock-layout-reserved', cardStyle.marginLeft);
        row?.style.setProperty('--dock-layout-balance', cardStyle.marginRight);
      } else {
        row?.style.removeProperty('--dock-layout-reserved');
        row?.style.removeProperty('--dock-layout-balance');
      }
      const root = getComputedStyle(element);
      layoutLeft = element.getBoundingClientRect().left;
      const siblings = [element.previousElementSibling, element.nextElementSibling];
      actions = siblings.filter((sibling): sibling is HTMLElement => sibling instanceof HTMLElement).map(sibling => {
        const rect = sibling.getBoundingClientRect();
        const transform = getComputedStyle(sibling).transform;
        return { left: rect.left - (transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41), width: rect.width };
      });
      const shell = element.querySelector<HTMLElement>('.shared-search-bar-shell');
      const searchInput = shell?.querySelector<HTMLInputElement>('input');
      const searchIcon = shell?.querySelector<SVGElement>('.shared-search-input-layer > svg');
      if (!motion.transition) lastSearchActive = shell?.dataset.searchActive === 'true';
      const send = element.querySelector<HTMLButtonElement>('.chat-send-button');
      const textarea = element.querySelector<HTMLTextAreaElement>('textarea');
      const composer = send?.closest<HTMLElement>('.chat-composer-surface');
      const textStyle = textarea ? getComputedStyle(textarea) : null;
      const textTranslation = textStyle?.transform && textStyle.transform !== 'none'
        ? new DOMMatrixReadOnly(textStyle.transform).m41 : 0;
      // The resolved minimum supplies the circle diameter. Wrapped content
      // belongs to the bar height and must not resize the detached buttons.
      const circle = shell ? parseFloat(getComputedStyle(shell).minHeight) || 40 : 40;
      const searchIconInset = searchIcon && shell ? searchIcon.getBoundingClientRect().left - shell.getBoundingClientRect().left + searchIcon.getBoundingClientRect().width / 2 : 28;
      const next: DockMeasure = {
        width: element.clientWidth,
        editorWidth: hasChat ? measure.editorWidth : (shell?.dataset.searchLayoutExpanded === 'true' ? 42 : 24) * parseFloat(getComputedStyle(document.documentElement).fontSize),
        searchHeight: circle,
        searchBodyHeight: searchHeight || shell?.getBoundingClientRect().height || circle,
        chatHeight: chatHeight || 76,
        gap: parseFloat(root.getPropertyValue('--dock-gap')) * parseFloat(getComputedStyle(document.documentElement).fontSize),
        sendSize: send?.getBoundingClientRect().width || measure.sendSize,
        sendInset: send && composer ? composer.getBoundingClientRect().right - send.getBoundingClientRect().right : measure.sendInset,
        searchIconInset,
        textPush: textarea && composer && searchInput && shell ? Math.max(0,
          searchInput.getBoundingClientRect().left - shell.getBoundingClientRect().left -
          (textarea.getBoundingClientRect().left - textTranslation - composer.getBoundingClientRect().left + parseFloat(textStyle!.paddingLeft))) : measure.textPush
      };
      if (JSON.stringify(next) !== JSON.stringify(measure)) measure = next;
      isStopAction = send?.dataset.chatAction === 'stop';
      sendOpacity = send && !send.disabled ? 1 : 0.4;
    };
    readLayout = read;
    read();
    // Pane motion briefly measures the destination before installing WAAPI.
    // Read its displayed starting bounds before the next paint, so that temporary
    // destination measurement can never become the first dock frame.
    const workspace = element.closest('.notepad-shell');
    const layoutReady = (event: Event) => {
      paneLayoutActive = !!workspace?.hasAttribute('data-pane-motion');
      const destination = (event as CustomEvent<{ id: number; left: number; width: number } | null>).detail;
      if (destination?.id === motion.transition?.id) layoutDestination = destination;
      read();
    };
    workspace?.addEventListener('workspace-pane-layout-ready', layoutReady);
    const paneLayout = new MutationObserver(() => {
      paneLayoutActive = !!workspace?.hasAttribute('data-pane-motion');
      read();
    });
    if (workspace) paneLayout.observe(workspace, { attributes: true, attributeFilter: ['data-pane-motion'] });
    let previousWidth = element.clientWidth;
    const size = new ResizeObserver(() => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      read();
    });
    const content = new MutationObserver(read);
    size.observe(element);
    content.observe(element, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-search-expanded', 'data-search-layout-expanded', 'data-search-active', 'disabled', 'data-chat-action'] });
    const finish = () => {
      cancelFrame();
      settling = undefined;
      motion = transitionWorkspaceDock(motion, { type: 'finish' });
      read();
    };
    media.addEventListener('change', finish);
    window.addEventListener('resize', finish);
    return { destroy() {
      size.disconnect(); content.disconnect(); paneLayout.disconnect(); media?.removeEventListener('change', finish);
      window.removeEventListener('resize', finish); readLayout = undefined;
      workspace?.removeEventListener('workspace-pane-layout-ready', layoutReady);
      for (const property of ['--dock-layout-reserved', '--dock-layout-balance', '--dock-action-0-shift', '--dock-action-1-shift']) {
        element.parentElement?.style.removeProperty(property);
      }
    } };
  }
  $effect(() => {
    searchHeight; chatHeight;
    untrack(() => readLayout?.());
  });
  onDestroy(cancelFrame);
</script>

<div bind:this={node} use:observeDock class="workspace-input-dock" style={styles}
  data-input-dock-mode={hasChat ? mode : 'search'} data-dock-state={target}
  data-dock-results-ready-at={motion.transition ? motion.transition.startedAt + motion.transition.duration : undefined}
  data-dock-started-at={motion.transition?.startedAt}
  data-dock-duration={motion.transition?.duration}
  data-dock-easing={motion.transition?.easing}
  data-dock-reading-clearance={hasChat ? Math.max(renderMeasure.chatHeight, renderMeasure.searchBodyHeight ?? measure.searchHeight) : undefined}
  data-dock-clearance={running ? (motion.transition?.from === 'chat-input' || target === 'chat-input'
    ? Math.max(renderMeasure.chatHeight, layoutOrigin?.measure.chatHeight ?? 0, renderMeasure.searchBodyHeight ?? measure.searchHeight)
    : renderMeasure.searchBodyHeight ?? measure.searchHeight) : undefined}
  data-dock-phase={phase} data-dock-text-reveal={presentation.textRevealing || undefined}
  data-dock-motion={running ? motion.transition?.id : settling}>
  <WorkspaceDockMaterial {filterId} {geometry} circle={measure.searchHeight} radius={bodyRadius} />
  <div class="dock-body">
    <WorkspaceDockSurface kind="search" active={target !== 'chat-input'} bind:contentHeight={searchHeight}>
      {#snippet content()}{@render search(searchPresentation)}{/snippet}
    </WorkspaceDockSurface>
    <WorkspaceDockSurface kind="chat" active={target === 'chat-input'} bind:contentHeight={chatHeight}>
      {#snippet content()}<div bind:this={chatSlot} class="workspace-chat-slot"></div>{/snippet}
    </WorkspaceDockSurface>
  </div>
  <button class="workspace-input-toggle dock-search-toggle" type="button" aria-label="Expand search" title="Search notes"
    aria-hidden={target !== 'chat-input' || undefined} tabindex={target === 'chat-input' ? 0 : -1} onclick={onSearch}
    style="--dock-icon-x:var(--dock-search-x);--dock-icon-size:var(--dock-search-size);--dock-icon-opacity:var(--dock-search-opacity);">
    <Search style="width:var(--dock-search-glyph);height:var(--dock-search-glyph);transform:translateX(var(--dock-search-glyph-shift));" />
  </button>
  <button class="workspace-input-toggle dock-chat-toggle" type="button" aria-label="Expand chat input" title="Return to chat"
    aria-hidden={target !== 'chat-search' || undefined} tabindex={target === 'chat-search' ? 0 : -1} onclick={onChat}
    style="--dock-icon-x:var(--dock-chat-x);--dock-icon-size:var(--dock-chat-size);--dock-icon-opacity:var(--dock-chat-opacity);">
    <MessagesSquare class="dock-chat-icon h-5 w-5" />
    {#if isStopAction}<Square class="dock-send-icon h-3.5 w-3.5 fill-current" />{:else}<ArrowUp class="dock-send-icon h-4 w-4" />{/if}
  </button>
</div>
