<script lang="ts">
  interface Props {
    open?: boolean;
    onToggle?: () => void;
  }
  let { open = false, onToggle }: Props = $props();
</script>

<!-- Desktop sidebar -->
<div class="relative hidden min-[950px]:flex flex-none transition-all duration-500 ease-in-out h-full items-start {open ? 'w-[340px] opacity-100' : 'w-0 opacity-0'}">
  <div class="absolute right-0 top-0 bottom-0 w-[340px] bg-white rounded-[2rem] shadow-sm border border-gray-200 flex flex-col overflow-hidden transition-transform duration-500 ease-in-out {open ? 'translate-x-0' : 'translate-x-full'}">
    <div class="p-8 pb-4 shrink-0 flex items-center justify-center relative">
      <h3 class="font-medium text-gray-900 text-lg">Related</h3>
      <button class="absolute right-6 top-8 text-gray-400 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-full p-1.5 transition-colors cursor-pointer" onclick={onToggle} aria-label="Close Related" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
      <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
        <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
        <p class="text-sm text-gray-600 leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>

      <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
        <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
        <p class="text-sm text-gray-600 leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>

      <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
        <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
        <p class="text-sm text-gray-600 leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>
    </div>
  </div>
</div>

<!-- Desktop edge trigger -->
{#if !open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed right-0 top-1/2 -translate-y-1/2 w-4 h-32 bg-white border border-gray-200 border-r-0 rounded-l-xl shadow-md cursor-pointer hover:w-6 transition-all hover:bg-gray-50 items-center justify-center group z-20 hidden min-[950px]:flex"
    onclick={onToggle}
    title="Open Related"
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && onToggle?.()}
  >
    <div class="w-1 h-10 rounded-full bg-gray-300 group-hover:bg-gray-400 transition-colors"></div>
  </div>
{/if}

<!-- Mobile bottom sheet -->
<div
  class="relative w-full flex-none min-[950px]:hidden overflow-visible transition-all duration-500 ease-in-out {open ? 'h-[min(360px,55vh)] pt-4' : 'h-0 pt-0'}"
>
  <div
    class="absolute inset-x-0 bottom-0 h-[min(360px,55vh)] bg-white rounded-[2rem] shadow-sm border border-gray-200 flex flex-col overflow-hidden transition-all duration-500 ease-in-out {open ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}"
  >
    <div class="p-8 pb-4 shrink-0 flex items-center justify-center relative">
      <h3 class="font-medium text-gray-900 text-lg">Related</h3>
      <button class="absolute right-6 top-8 text-gray-400 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-full p-1.5 transition-colors cursor-pointer" onclick={onToggle} aria-label="Close Related" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
      <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
        <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
        <p class="text-sm text-gray-600 leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>

      <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
        <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
        <p class="text-sm text-gray-600 leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>

      <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
        <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
        <p class="text-sm text-gray-600 leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>
    </div>
  </div>

  {#if !open}
    <button
      class="absolute left-1/2 top-0 flex h-5 w-28 -translate-x-1/2 items-start justify-center rounded-t-2xl border border-gray-200 border-b-0 bg-white shadow-md transition-all hover:h-6 hover:bg-gray-50"
      onclick={onToggle}
      aria-label="Open Related"
      type="button"
    >
      <span class="sr-only">Open Related</span>
      <span class="mt-1.5 h-1 w-10 rounded-full bg-gray-300 transition-colors"></span>
    </button>
  {/if}
</div>
