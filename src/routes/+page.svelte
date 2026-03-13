<script lang="ts">
  import Notepad from '$lib/components/Notepad.svelte';
</script>

<div class="h-full w-full bg-background text-foreground flex flex-col overflow-hidden">
  <main class="flex-1 relative flex flex-col min-[950px]:flex-row overflow-hidden pb-4 transition-all duration-300 ease-in-out justify-center max-w-[1600px] mx-auto w-full">
    <div class="flex-1 flex justify-center h-full min-h-0 transition-all duration-500 max-w-5xl w-full">
      <Notepad />
    </div>
  </main>
</div>
