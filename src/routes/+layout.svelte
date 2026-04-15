<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";
  import { initializeTheme } from '$lib/theme';
  import { mobileViewport } from '$lib/ui/mobileViewport';
  import NavBar from '$lib/ui/NavBar.svelte';

  let { children } = $props();

  onMount(() => {
    void initializeTheme();
  });
</script>

<div use:mobileViewport class="app-shell flex h-full min-h-full flex-col overflow-hidden bg-background text-foreground">
  <NavBar />
  <div class="flex-1 min-h-0 overflow-hidden px-0 sm:px-4">
    {@render children()}
  </div>
</div>
