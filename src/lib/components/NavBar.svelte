<script lang="ts">
  import { page } from '$app/stores';
  import { Settings } from 'lucide-svelte';

  const navLinks = [
    { href: '/', label: 'Gneauxght' },
    { href: '/inbox', label: 'Inbox' },
    { href: '/map', label: 'Map' },
    { href: '/list', label: 'List' }
  ] as const;

  function isActive(href: string, pathname: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  const linkClass = (href: string) =>
    `inline-flex w-[105px] items-center justify-center text-sm font-medium transition-colors px-2 rounded-full ${
      isActive(href, $page.url.pathname)
        ? 'text-gray-900 bg-white py-2 shadow-sm'
        : 'text-gray-500 hover:text-gray-900'
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
</script>

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
    <nav class="flex items-center gap-0 bg-white/50 backdrop-blur-md rounded-full shadow-sm ">
      {#each navLinks as { href, label }}
        <a href={href} class={linkClass(href)}>{label}</a>
      {/each}
    </nav>
  </div>

  <div class="relative z-10 flex justify-end min-w-0">
    <button class="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-200 bg-white rounded-full transition-colors shadow-sm" type="button" aria-label="Settings">
      <Settings class="w-5 h-5" />
    </button>
  </div>
</header>
