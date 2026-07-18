<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";
  import { initializeTheme } from '$lib/theme';
  import '$lib/editorTextSize';
  import { mobileViewport } from '$lib/ui/mobileViewport';
  import NavBar from '$lib/ui/NavBar.svelte';
  import { appStore } from '$lib/app/appStore.svelte';
  import { logDevError } from '$lib/logDevError';
  import { page } from '$app/state';
  import { invoke } from '@tauri-apps/api/core';

  let { children } = $props();

  onMount(() => {
    void initializeTheme();
    // Bootstrap the unified AppStore once at the layout level so backend
    // events have a single subscriber and feature stores can read
    // vault/semantic/AI snapshots from one place.
    void appStore.bootstrap().catch((error) => {
      logDevError('[AppStore] bootstrap failed; feature stores will fall back to per-feature loads', error);
    });
    let lastReport = 0;
    const reportActivity = () => {
      const now = Date.now();
      if (now - lastReport < 2_000) return;
      lastReport = now;
      void invoke('report_user_activity').catch(() => undefined);
    };
    const activityEvents = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'input'] as const;
    for (const event of activityEvents) {
      window.addEventListener(event, reportActivity, { passive: true, capture: true });
    }
    return () => {
      for (const event of activityEvents) {
        window.removeEventListener(event, reportActivity, { capture: true });
      }
    };
  });
</script>

<div
  use:mobileViewport
  class="flex h-(--app-shell-height) min-h-(--app-shell-height) flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top,0px)] text-foreground"
>
  <NavBar />
  <div class="flex-1 min-h-0 overflow-hidden px-0 sm:px-4">
    {#key page.url.pathname}
      {@render children()}
    {/key}
  </div>
</div>
