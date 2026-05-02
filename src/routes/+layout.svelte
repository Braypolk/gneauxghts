<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";
  import { initializeTheme } from '$lib/theme';
  import { mobileViewport } from '$lib/ui/mobileViewport';
  import NavBar from '$lib/ui/NavBar.svelte';
  import { appStore } from '$lib/app/appStore.svelte';

  let { children } = $props();

  onMount(() => {
    void initializeTheme();
    // Break-the-app: bootstrap the unified AppStore once at the layout
    // level so backend events have a single subscriber and downstream
    // feature stores can read vault/semantic/AI snapshots from one place.
    void appStore.bootstrap().catch(() => {
      // Bootstrap is best-effort; feature stores fall back to their
      // existing per-feature loads if AppStore boot fails.
    });
  });
</script>

<div use:mobileViewport class="app-shell flex h-full min-h-full flex-col overflow-hidden bg-background text-foreground">
  <NavBar />
  <div class="flex-1 min-h-0 overflow-hidden px-0 sm:px-4">
    {@render children()}
  </div>
</div>
