<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";
  import { initializeTheme } from '$lib/theme';
  import { mobileViewport } from '$lib/ui/mobileViewport';
  import NavBar from '$lib/ui/NavBar.svelte';
  import { appStore } from '$lib/app/appStore.svelte';
  import { logDevError } from '$lib/logDevError';

  let { children } = $props();

  onMount(() => {
    void initializeTheme();
    // Bootstrap the unified AppStore once at the layout level so backend
    // events have a single subscriber and feature stores can read
    // vault/semantic/AI snapshots from one place.
    void appStore.bootstrap().catch((error) => {
      logDevError('[AppStore] bootstrap failed; feature stores will fall back to per-feature loads', error);
    });
  });
</script>

<div use:mobileViewport class="app-shell flex h-full min-h-full flex-col overflow-hidden bg-background text-foreground">
  <NavBar />
  <div class="flex-1 min-h-0 overflow-hidden px-0 sm:px-4">
    {@render children()}
  </div>
</div>
