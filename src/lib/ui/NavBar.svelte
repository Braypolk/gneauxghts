<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { House, ListTodo, Network, Settings } from '@lucide/svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { awaitPendingNoteSave } from '$lib/features/notepad/navigation/pendingNoteSave';
  import { keyboardShortcutMatchesEvent } from '$lib/keyboardShortcuts.svelte';
  import { isTauriRuntime } from '$lib/tauriRuntime';
  import { bumpAppShellViewGeneration } from '$lib/ui/appShellNavigation.svelte';
  import { createNavigationCoordinator } from '$lib/ui/navigationCoordinator';

  const navLinks = [
    { href: '/map', label: 'Map', icon: Network },
    { href: '/', label: 'Gneauxght', icon: House },
    { href: '/list', label: 'List', icon: ListTodo },
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
    `relative inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm font-medium transition-colors sm:h-auto sm:w-auto sm:min-w-[105px] sm:gap-2 sm:px-3 sm:py-2 ${
      isActive(href, currentPathname)
        ? 'border-foreground/15 bg-card text-foreground shadow-sm'
        : 'border-transparent text-muted-foreground hover:border-border/80 hover:text-foreground'
    }`;

  const settingsButtonClass = () =>
    `rounded-full border border-border/80 p-2 shadow-sm transition-colors ${
      isActive(settingsHref, currentPathname)
        ? 'bg-accent text-accent-foreground'
        : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`;

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

<svelte:window onkeydown={handleGlobalShortcut} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
  class="app-navigation-header relative z-10 shrink-0 grid min-h-[3.5rem] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-1.5 select-none sm:min-h-[4.75rem] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-0 sm:px-6 sm:pt-4 sm:pb-4"
  onmousedown={handleHeaderMouseDown}
>
  <div data-tauri-drag-region class="absolute inset-x-0 top-0 h-8"></div>

  <div class="relative z-10 hidden min-w-0 justify-start sm:flex">
    <!-- Reserved for native window controls and drag area -->
  </div>

  <div class="relative z-10 flex min-w-0 justify-start sm:justify-center">
    <nav class="flex items-center gap-1 rounded-full border border-border/80 bg-card/70 p-1 shadow-sm backdrop-blur-md sm:gap-1 sm:p-1">
      {#each navLinks as { href, label, icon } (href)}
        {@const Icon = icon}
        <a
          href={resolve(href)}
          data-sveltekit-preload-data="off"
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
      data-sveltekit-preload-data="off"
      class={settingsButtonClass()}
      aria-label="Settings"
      aria-current={isActive(settingsHref, currentPathname) ? 'page' : undefined}
      onclick={(event) => void handleNavClick(event, settingsHref)}
    >
      <Settings class="w-5 h-5" />
    </a>
  </div>
</header>

<style>
  @media (max-height: 559px) {
    .app-navigation-header {
      min-height: 3.5rem;
      padding: 0.25rem 0.75rem;
    }
  }
</style>
