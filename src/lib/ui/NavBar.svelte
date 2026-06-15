<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { House, ListTodo, Map, Settings } from '@lucide/svelte';
  import FeatherWriting from './icons/FeatherWriting.svelte';
  import MailboxEmpty from './icons/MailboxEmpty.svelte';
  import MailboxFull from './icons/MailboxFull.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { awaitPendingNoteSave } from '$lib/features/notepad/navigation/pendingNoteSave';
  import { keyboardShortcutMatchesEvent } from '$lib/keyboardShortcuts';
  import { createNavStatusStore } from '$lib/ui/navStatusStore';

  const navLinks = [
    { href: '/', label: 'Note', icon: House },
    { href: '/inbox', label: 'Inbox', icon: MailboxEmpty },
    { href: '/map', label: 'Map', icon: Map },
    { href: '/list', label: 'List', icon: ListTodo }
  ] as const;
  const settingsHref = '/settings';
  const navStatusStore = createNavStatusStore();

  function isActive(href: string, pathname: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  const linkClass = (href: string) =>
    `relative inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm font-medium transition-colors sm:h-auto sm:w-auto sm:min-w-[105px] sm:gap-2 sm:px-3 sm:py-2 ${
      isActive(href, $page.url.pathname)
        ? 'border-foreground/15 bg-card text-foreground shadow-sm'
        : 'border-transparent text-muted-foreground hover:border-border/80 hover:text-foreground'
    }`;

  const settingsButtonClass = () =>
    `rounded-full border border-border/80 p-2 shadow-sm transition-colors ${
      isActive(settingsHref, $page.url.pathname)
        ? 'bg-accent text-accent-foreground'
        : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`;

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element
      && target.closest('a, button, input, textarea, select, option, [role="button"], [data-no-window-drag]') !== null;
  }

  async function handleHeaderMouseDown(event: MouseEvent) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }

    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  }

  function shouldBypassAppNavigation(event: MouseEvent) {
    return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  async function navigateToHref(href: string) {
    if ($page.url.pathname === href) {
      return;
    }

    await awaitPendingNoteSave();
    await goto(href);
  }

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
      ['navNote', navLinks[0]],
      ['navInbox', navLinks[1]],
      ['navMap', navLinks[2]],
      ['navList', navLinks[3]]
    ] as const;

    for (const [shortcutId, targetLink] of shortcutEntries) {
      if (!targetLink || !keyboardShortcutMatchesEvent(event, shortcutId)) {
        continue;
      }

      event.preventDefault();
      void navigateToHref(targetLink.href);
      return;
    }
  }

  onMount(() => {
    navStatusStore.initialize();
  });

  onDestroy(() => {
    navStatusStore.dispose();
  });
</script>

<svelte:window onkeydown={handleGlobalShortcut} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
  class="relative z-10 shrink-0 grid min-h-[3.75rem] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-4 pt-3 pb-2 select-none sm:min-h-[4.75rem] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-0 sm:px-6 sm:pt-4 sm:pb-4"
  onmousedown={handleHeaderMouseDown}
>
  <div data-tauri-drag-region class="absolute inset-x-0 top-0 h-8"></div>

  <div class="relative z-10 hidden min-w-0 justify-start sm:flex">
    <!-- Reserved for native window controls and drag area -->
  </div>

  <div class="relative z-10 flex min-w-0 justify-start sm:justify-center">
    <nav class="flex items-center gap-1 rounded-full border border-border/80 bg-card/70 p-1 shadow-sm backdrop-blur-md sm:gap-0 sm:p-0">
      {#each navLinks as { href, label, icon }}
        {@const Icon = icon}
        <a
          href={href}
          class={linkClass(href)}
          aria-label={label}
          onclick={(event) => void handleNavClick(event, href)}
        >
          {#if href === '/inbox'}
            {#if $navStatusStore.inboxStatusIndicator === 'running'}
              <FeatherWriting class="h-4 w-4 shrink-0" />
            {:else if $navStatusStore.inboxStatusIndicator === 'pendingApproval'}
              <MailboxFull class="h-4 w-4 shrink-0" />
            {:else}
              <MailboxEmpty class="h-4 w-4 shrink-0" />
            {/if}
          {:else}
            <Icon class="h-4 w-4 shrink-0" />
          {/if}
          <span class="hidden sm:inline">{label}</span>
        </a>
      {/each}
    </nav>
  </div>

  <div class="relative z-10 flex min-w-0 justify-end">
    <a
      href={settingsHref}
      class={settingsButtonClass()}
      aria-label="Settings"
      onclick={(event) => void handleNavClick(event, settingsHref)}
    >
      <Settings class="w-5 h-5" />
    </a>
  </div>
</header>
