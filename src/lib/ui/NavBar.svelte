<script lang="ts">
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { DropdownMenu } from 'bits-ui';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Check, ChevronDown, House, ListTodo, Network, Settings } from '@lucide/svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { awaitPendingNoteSave } from '#lib/features/notepad/navigation/pendingNoteSave.js';
  import { keyboardShortcutMatchesEvent } from '#lib/keyboardShortcuts.svelte.js';
  import { isTauriRuntime } from '#lib/tauriRuntime.js';
  import { bumpAppShellViewGeneration } from '#lib/ui/appShellNavigation.svelte.js';
  import { createNavigationCoordinator } from '#lib/ui/navigationCoordinator.js';

  const navLinks = [
    { href: '/map', label: 'Map', icon: Network },
    { href: '/', label: 'Gneauxght', icon: House },
    { href: '/list', label: 'List', icon: ListTodo },
    { href: '/settings', label: 'Settings', icon: Settings },
  ] as const;
  const settingsHref = '/settings';

  function normalizePathname(pathname: string): string {
    const withoutIndex = pathname === '/index.html'
      ? '/'
      : pathname.replace(/\/index\.html$/, '');
    if (withoutIndex.endsWith('/') && withoutIndex !== '/') {
      return withoutIndex.slice(0, -1);
    }
    return withoutIndex || '/';
  }

  let currentPathname = $derived(normalizePathname(page.url.pathname));

  function isActive(href: string, pathname: string): boolean {
    const normalizedHref = normalizePathname(href);
    if (normalizedHref === '/') return pathname === '/';
    return pathname === normalizedHref || pathname.startsWith(`${normalizedHref}/`);
  }

  const linkClass = (href: string) =>
    `mobile-touch-target relative inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm font-medium transition-colors sm:h-auto sm:w-auto sm:min-w-[105px] sm:gap-2 sm:px-3 sm:py-2 ${
      isActive(href, currentPathname)
        ? 'border-foreground/15 bg-card text-foreground shadow-sm'
        : 'border-transparent text-muted-foreground hover:border-border/80 hover:text-foreground'
    }`;

  const settingsButtonClass = () =>
    `mobile-touch-target inline-flex items-center justify-center rounded-full border border-border/80 p-2 shadow-sm transition-colors ${
      isActive(settingsHref, currentPathname)
        ? 'bg-accent text-accent-foreground'
        : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`;

  // Match the note card's edge-to-edge breakpoint.
  const compact = new MediaQuery('(max-width: 639px), (any-pointer: coarse) and (max-height: 559px)');
  let menuOpen = $state(false);
  let navigationButton = $state<HTMLButtonElement | null>(null);
  let selectionPointer: number | null = null;
  let pointerSelection = $state<string | null>(null);
  const activeLink = $derived(navLinks.find(link => isActive(link.href, currentPathname)) ?? navLinks[1]);

  function pointerDestination(event: PointerEvent) {
    const item = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-app-nav-href]');
    return item?.dataset.appNavHref ?? null;
  }

  // Capture the press so releasing over an item works for mouse, pen and touch.
  function beginPointerSelection(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    menuOpen = !menuOpen;
    if (!menuOpen) return;
    selectionPointer = event.pointerId;
    pointerSelection = null;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function movePointerSelection(event: PointerEvent) {
    if (event.pointerId === selectionPointer) pointerSelection = pointerDestination(event);
  }

  function endPointerSelection(event: PointerEvent) {
    if (event.pointerId !== selectionPointer) return;
    event.preventDefault();
    const href = menuOpen ? pointerDestination(event) : null;
    const rect = navigationButton!.getBoundingClientRect();
    const overTrigger = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    selectionPointer = null;
    pointerSelection = null;
    if (href) {
      menuOpen = false;
      void navigateToHref(href);
    } else if (!overTrigger) menuOpen = false;
  }

  function cancelPointerSelection() {
    if (selectionPointer !== null) menuOpen = false;
    selectionPointer = null;
    pointerSelection = null;
  }

  $effect(() => { currentPathname; compact.current; cancelPointerSelection(); menuOpen = false; });
  onMount(() => {
    // Resolve before the menu's outside-dismiss handler processes a captured release.
    window.addEventListener('pointerup', endPointerSelection, true);
    return () => window.removeEventListener('pointerup', endPointerSelection, true);
  });

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element
      && target.closest('a, button, input, textarea, select, option, [role="button"], [data-no-window-drag]') !== null;
  }

  async function handleHeaderMouseDown(event: MouseEvent) {
    if (event.button !== 0 || isInteractiveTarget(event.target) || !isTauriRuntime()) {
      return;
    }

    await getCurrentWindow().startDragging();
  }

  function shouldBypassAppNavigation(event: MouseEvent) {
    return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  async function navigateToHref(href: string) {
    await navigationCoordinator.request(href);
  }

  const navigationCoordinator = createNavigationCoordinator({
    getCurrentPathname: () => currentPathname,
    normalizePathname,
    flushPendingWork: awaitPendingNoteSave,
    navigate: (href) => goto(resolve(href as '/' | '/map' | '/list' | '/settings' | '/atlas')),
    onForceRemount: bumpAppShellViewGeneration,
    onFlushError: (error) => {
      console.error('Failed to flush pending note save before navigation:', error);
    }
  });

  async function handleNavClick(event: MouseEvent, href: string) {
    if (shouldBypassAppNavigation(event)) {
      return;
    }

    event.preventDefault();
    await navigateToHref(href);
  }

  function handleGlobalShortcut(event: KeyboardEvent) {
    if (keyboardShortcutMatchesEvent(event, 'navSettings')) {
      event.preventDefault();
      void navigateToHref(settingsHref);
      return;
    }

    const shortcutEntries = [
      ['navNote', '/'],
      ['navList', '/list'],
      ['navAtlas', '/map']
    ] as const;

    for (const [shortcutId, href] of shortcutEntries) {
      if (!keyboardShortcutMatchesEvent(event, shortcutId)) {
        continue;
      }

      event.preventDefault();
      void navigateToHref(href);
      return;
    }
  }

</script>

<svelte:window onkeydown={handleGlobalShortcut} onpointercancel={cancelPointerSelection} onblur={cancelPointerSelection} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
  class={compact.current ? "app-navigation-header app-navigation-header--compact" : "app-navigation-header relative z-10 shrink-0 grid min-h-[3.5rem] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-1.5 select-none sm:min-h-[4.75rem] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-0 sm:px-6 sm:pt-4 sm:pb-4"}
  class:app-navigation-header--editor={currentPathname === '/'}
  onmousedown={handleHeaderMouseDown}
>
  {#if compact.current}
    <div data-tauri-drag-region class="app-window-drag-region"></div>
    <DropdownMenu.Root bind:open={menuOpen}>
      <DropdownMenu.Trigger
        bind:ref={navigationButton}
        class="app-navigation-button"
        aria-label="Switch tab"
        title={`${activeLink.label} — switch tab`}
        onpointerdown={beginPointerSelection}
        onpointermove={movePointerSelection}
        onpointerup={(event) => { if (event.pointerType === 'touch') event.preventDefault(); }}
        oncontextmenu={(event) => event.preventDefault()}
      >
        {@const ActiveIcon = activeLink.icon}
        <ActiveIcon class="h-5 w-5" />
        <span class="app-navigation-label">{activeLink.label}</span>
        <ChevronDown class="app-navigation-chevron" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={8} class="app-navigation-menu" aria-label="Tabs">
          {#each navLinks as { href, label, icon } (href)}
            {@const Icon = icon}
            <DropdownMenu.Item>
              {#snippet child({ props })}
                <a {...props}
                  href={resolve(href)}
                  data-sveltekit-preload-data="false"
                  data-app-nav-href={href}
                  class="app-navigation-item"
                  class:app-navigation-item--touch={pointerSelection === href}
                  aria-label={label}
                  aria-current={isActive(href, currentPathname) ? 'page' : undefined}
                  onclick={(event) => { if (typeof props.onclick === 'function') props.onclick(event); void handleNavClick(event, href); }}
                >
                  <Icon class="h-4 w-4" />
                  <span>{label}</span>
                  {#if isActive(href, currentPathname)}<Check class="ml-auto h-4 w-4" />{/if}
                </a>
              {/snippet}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  {:else}
    <div data-tauri-drag-region class="absolute inset-x-0 top-0 h-8"></div>

    <div class="relative z-10 hidden min-w-0 justify-start sm:flex">
      <!-- Reserved for native window controls and drag area -->
    </div>

    <div class="relative z-10 flex min-w-0 justify-start sm:justify-center">
      <nav class="flex items-center gap-1 rounded-full border border-border/80 bg-card/70 p-1 shadow-sm backdrop-blur-md sm:gap-1 sm:p-1">
        {#each navLinks.filter(link => link.href !== settingsHref) as { href, label, icon } (href)}
          {@const Icon = icon}
          <a
            href={resolve(href)}
            data-sveltekit-preload-data="false"
            class={linkClass(href)}
            aria-label={label}
            aria-current={isActive(href, currentPathname) ? 'page' : undefined}
            onclick={(event) => void handleNavClick(event, href)}
          >
            <Icon class="h-4 w-4 shrink-0" />
            <span class="hidden sm:inline">{label}</span>
          </a>
        {/each}
      </nav>
    </div>

    <div class="relative z-10 flex min-w-0 justify-end">
      <a
        href={resolve(settingsHref)}
        data-sveltekit-preload-data="false"
        class={settingsButtonClass()}
        aria-label="Settings"
        aria-current={isActive(settingsHref, currentPathname) ? 'page' : undefined}
        onclick={(event) => void handleNavClick(event, settingsHref)}
      >
        <Settings class="w-5 h-5" />
      </a>
    </div>
  {/if}
</header>

<style>
  .app-navigation-header--compact {
    position: relative;
    z-index: 40;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    height: 4rem;
    padding: 0 0.75rem;
    pointer-events: none;
    user-select: none;
  }
  .app-navigation-header--compact.app-navigation-header--editor {
    position: absolute;
    inset: var(--app-shell-top-inset, 0px) var(--app-safe-area-right, 0px) auto var(--app-safe-area-left, 0px);
  }
  .app-navigation-header--compact.app-navigation-header--editor .app-window-drag-region { height: 0.5rem; }
  .app-window-drag-region { position: absolute; inset: 0 0 auto; height: 2rem; pointer-events: auto; }
  :global(.app-navigation-button) {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    max-width: calc(100vw - 2rem);
    padding: 0 0.75rem;
    gap: 0.375rem;
    height: 2.75rem;
    border: 1px solid var(--border);
    border-radius: 9999px;
    background: var(--card);
    color: var(--foreground);
    pointer-events: auto;
    touch-action: none;
  }
  :global(.app-navigation-button:hover), :global(.app-navigation-button[data-state='open']) { background: var(--accent); }
  :global(.app-navigation-button:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
  :global(.app-navigation-chevron) { width: 0.75rem; height: 0.75rem; flex-shrink: 0; color: var(--muted-foreground); }
  :global(.app-navigation-button > svg) { flex-shrink: 0; }
  :global(.app-navigation-label) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.875rem; font-weight: 500; }
  .app-navigation-header--editor :global(.app-navigation-button) { max-width: calc(100vw - 21rem); }
  @media (max-width: 479px) {
    .app-navigation-header--editor :global(.app-navigation-button) { max-width: calc(100vw - 16rem); padding-inline: 0.5rem; gap: 0.25rem; }
  }
  @media (max-width: 639px) {
    /* Leave room for the full-size action group. Opening a right pane keeps
       the selector at its solo position; a trailing rail shifts it with the
       left pane's actions. Closing rails no longer reserve destination space. */
    :global(.app-shell:has([data-pane-collapsed]:not(.notepad-pane--collapsing):last-child)) .app-navigation-header--editor {
      right: calc(var(--app-safe-area-right, 0px) + 2 * var(--pane-rail-width, 48px));
    }
  }
  :global(.app-navigation-button[data-state='open'] .app-navigation-chevron) { transform: rotate(180deg); }
  :global(.app-navigation-menu) {
    z-index: 60;
    width: 12rem;
    max-width: calc(100vw - 1rem);
    padding: 0.375rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--popover);
    color: var(--popover-foreground);
    box-shadow: var(--shadow-lg);
    outline: none;
  }
  :global(.app-navigation-item) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.625rem;
    font-size: 0.875rem;
    outline: none;
    user-select: none;
    touch-action: none;
  }
  :global(.app-navigation-item[data-highlighted]), :global(.app-navigation-item--touch) { background: var(--accent); color: var(--accent-foreground); }
  @media (max-height: 559px) {
    .app-navigation-header:not(.app-navigation-header--compact) { min-height: 3.5rem; padding: 0.25rem 0.75rem; }
  }
  @media (any-pointer: coarse) and (orientation: landscape) {
    :global(.app-shell[data-keyboard-open='true']) .app-navigation-header--compact { height: 2.75rem; }
  }
</style>
