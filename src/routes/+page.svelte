<script lang="ts">
  import Notepad from '$lib/components/Notepad.svelte';
  import Related from '$lib/components/Related.svelte';

  let isRelatedOpen = $state(false);

  function toggleRelated() {
    isRelatedOpen = !isRelatedOpen;
  }
</script>

<div class="h-full w-full bg-[#f8f9fa] flex flex-col font-sans overflow-hidden">
  <main class="flex-1 relative flex flex-col min-[950px]:flex-row overflow-hidden pb-4 transition-all duration-300 ease-in-out justify-center max-w-[1600px] mx-auto w-full">
    <!-- Notepad Container -->
    <div
      class="flex-1 flex justify-center h-full min-h-0 transition-all duration-500 max-w-5xl w-full {isRelatedOpen ? 'min-[950px]:mr-6' : ''}"
    >
      <Notepad />
    </div>

    <Related open={isRelatedOpen} onToggle={toggleRelated} />
  </main>
</div>
