<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";
  import { initializeTheme } from '$lib/theme';
  import NavBar from '$lib/ui/NavBar.svelte';

  let { children } = $props();

  onMount(() => {
    void initializeTheme();
  });
</script>

<div class="min-h-full h-full flex flex-col overflow-hidden bg-background text-foreground">
  <NavBar />
  <div class="flex-1 min-h-0 overflow-hidden px-3 sm:px-4">
    {@render children()}
  </div>
</div>
