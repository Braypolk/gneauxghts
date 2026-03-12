<script lang="ts">
  interface Props {
    open?: boolean;
    onToggle?: () => void;
  }
  let { open = false, onToggle }: Props = $props();

  const relatedCardClass =
    'rounded-3xl border border-transparent bg-background p-5 transition-colors hover:border-border hover:bg-accent';
</script>

<!-- Desktop sidebar -->
<div class="relative hidden min-[950px]:flex flex-none transition-all duration-500 ease-in-out h-full items-start {open ? 'w-[340px] opacity-100' : 'w-0 opacity-0'}">
  <div class="absolute right-0 top-0 bottom-0 w-[340px] bg-card text-card-foreground rounded-[2rem] shadow-sm border border-border flex flex-col overflow-hidden transition-transform duration-500 ease-in-out {open ? 'translate-x-0' : 'translate-x-full'}">
    <div class="p-8 pb-4 shrink-0 flex items-center justify-center relative">
      <h3 class="font-medium text-lg">Related</h3>
      <button class="absolute right-6 top-8 rounded-full bg-muted p-1.5 text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground" onclick={onToggle} aria-label="Close Related" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
      <div class="{relatedCardClass} cursor-pointer">
        <h4 class="font-semibold mb-2">Note 1</h4>
        <p class="text-sm text-muted-foreground leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>

      <div class="{relatedCardClass} cursor-pointer">
        <h4 class="font-semibold mb-2">Note 1</h4>
        <p class="text-sm text-muted-foreground leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>

      <div class="{relatedCardClass} cursor-pointer">
        <h4 class="font-semibold mb-2">Note 1</h4>
        <p class="text-sm text-muted-foreground leading-relaxed">
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
    class="fixed right-0 top-1/2 -translate-y-1/2 w-4 h-32 rounded-l-xl border border-r-0 border-border bg-card shadow-md cursor-pointer transition-all hover:w-6 hover:bg-muted items-center justify-center group z-20 hidden min-[950px]:flex"
    onclick={onToggle}
    title="Open Related"
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && onToggle?.()}
  >
    <div class="w-1 h-10 rounded-full bg-border group-hover:bg-muted-foreground/55 transition-colors"></div>
  </div>
{/if}

<!-- Mobile bottom sheet -->
<div
  class="relative w-full flex-none min-[950px]:hidden overflow-visible transition-all duration-500 ease-in-out {open ? 'h-[min(360px,55vh)] pt-4' : 'h-0 pt-0'}"
>
  <div
    class="absolute inset-x-0 bottom-0 h-[min(360px,55vh)] bg-card text-card-foreground rounded-[2rem] shadow-sm border border-border flex flex-col overflow-hidden transition-all duration-500 ease-in-out {open ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}"
  >
    <div class="p-8 pb-4 shrink-0 flex items-center justify-center relative">
      <h3 class="font-medium text-lg">Related</h3>
      <button class="absolute right-6 top-8 rounded-full bg-muted p-1.5 text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground" onclick={onToggle} aria-label="Close Related" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
      <div class="{relatedCardClass} cursor-pointer">
        <h4 class="font-semibold mb-2">Note 1</h4>
        <p class="text-sm text-muted-foreground leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>

      <div class="{relatedCardClass} cursor-pointer">
        <h4 class="font-semibold mb-2">Note 1</h4>
        <p class="text-sm text-muted-foreground leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>

      <div class="{relatedCardClass} cursor-pointer">
        <h4 class="font-semibold mb-2">Note 1</h4>
        <p class="text-sm text-muted-foreground leading-relaxed">
          most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
        </p>
      </div>
    </div>
  </div>

  {#if !open}
    <button
      class="absolute left-1/2 top-0 flex h-5 w-28 -translate-x-1/2 items-start justify-center rounded-t-2xl border border-border border-b-0 bg-card shadow-md transition-all hover:h-6 hover:bg-muted"
      onclick={onToggle}
      aria-label="Open Related"
      type="button"
    >
      <span class="sr-only">Open Related</span>
      <span class="mt-1.5 h-1 w-10 rounded-full bg-border transition-colors"></span>
    </button>
  {/if}
</div>
