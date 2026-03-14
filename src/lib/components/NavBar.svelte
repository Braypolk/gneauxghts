<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { Settings } from 'lucide-svelte';

  const navLinks = [
    { href: '/', label: 'Gneauxght' },
    { href: '/inbox', label: 'Inbox' },
    { href: '/map', label: 'Map' },
    { href: '/list', label: 'List' }
  ] as const;
  const settingsHref = '/settings';

  function isActive(href: string, pathname: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  const linkClass = (href: string) =>
    `inline-flex min-w-[105px] items-center justify-center rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
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

  function handleGlobalShortcut(event: KeyboardEvent) {
    if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }

    if (event.code === 'Comma') {
      event.preventDefault();
      void goto(settingsHref);
      return;
    }

    const shortcutMatch = event.code.match(/^Digit(\d)$/);
    if (!shortcutMatch) {
      return;
    }

    const shortcutIndex = Number(shortcutMatch[1]) - 1;
    const targetLink = navLinks[shortcutIndex];
    if (!targetLink) {
      return;
    }

    event.preventDefault();
    void goto(targetLink.href);
  }
</script>

<svelte:window onkeydown={handleGlobalShortcut} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
  class="relative z-10 shrink-0 px-6 pt-4 pb-4 min-h-[4.75rem] grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center select-none"
  onmousedown={handleHeaderMouseDown}
>
  <div data-tauri-drag-region class="absolute inset-x-0 top-0 h-8"></div>

  <div class="relative z-10 flex justify-start min-w-0">
    <!-- Reserved for native window controls and drag area -->
  </div>

  <div class="relative z-10 flex justify-center">
    <nav class="flex items-center gap-0 rounded-full border border-border/80 bg-card/70 shadow-sm backdrop-blur-md">
      {#each navLinks as { href, label }}
        <a href={href} class={linkClass(href)}>
          {label}
        </a>
      {/each}
    </nav>
  </div>

  <div class="relative z-10 flex justify-end min-w-0">
    <a
      href={settingsHref}
      class={settingsButtonClass()}
      aria-label="Settings"
    >
      <Settings class="w-5 h-5" />
    </a>
  </div>
</header>
