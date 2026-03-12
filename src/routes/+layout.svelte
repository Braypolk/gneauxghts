<script lang="ts">
  let { children } = $props();
  import "../app.css";
  import NavBar from "$lib/components/NavBar.svelte";
</script>

<div class="min-h-full h-full flex flex-col overflow-hidden">
  <NavBar />
  <div class="flex-1 min-h-0 overflow-hidden px-4">
    {@render children()}
  </div>
</div>