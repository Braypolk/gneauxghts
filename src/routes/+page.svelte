<script lang="ts">
  import Notepad from '$lib/components/Notepad.svelte';
</script>

<div class="h-full w-full bg-background text-foreground flex flex-col overflow-hidden">
  <main class="relative mx-auto flex w-full max-w-[1600px] flex-1 flex-col justify-center overflow-hidden pb-0 transition-all duration-300 ease-in-out min-[950px]:flex-row sm:pb-4">
    <div class="flex h-full min-h-0 w-full max-w-5xl flex-1 justify-center transition-all duration-500">
      <Notepad />
    </div>
  </main>
</div>
