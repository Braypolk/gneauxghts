<script lang="ts">
  import { untrack } from 'svelte';

  let {
    revisionId,
    label,
    disabled,
    onSave,
    onRemove,
    onCancel
  }: {
    revisionId: string;
    label: string | null;
    disabled: boolean;
    onSave: (revisionId: string, label: string) => void | Promise<void>;
    onRemove: (revisionId: string) => void | Promise<void>;
    onCancel: () => void;
  } = $props();

  let draft = $state(untrack(() => label ?? ''));
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    input?.focus();
    input?.select();
  });

  function save(event: SubmitEvent) {
    event.preventDefault();
    const nextLabel = draft.trim();
    if (!nextLabel) return;
    void onSave(revisionId, nextLabel);
  }
</script>

<section class="mb-2" aria-label="Named Revision">
  <form class="flex flex-wrap items-center gap-1" onsubmit={save}>
    <input
      bind:this={input}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          onCancel();
        }
      }}
      class="w-full min-w-0 basis-full border-b border-border bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground/65 hover:border-border focus:border-foreground/40"
      aria-label="Revision name"
      placeholder="Name this revision"
      bind:value={draft}
      {disabled}
    />
    <button
      type="submit"
      class="rounded-full px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"
      disabled={disabled || draft.trim() === '' || draft.trim() === label}
    >
      {label ? 'Save name' : 'Add name'}
    </button>
    <button type="button" class="rounded-full px-3 py-2 text-xs text-muted-foreground hover:bg-accent" onclick={onCancel}>Cancel</button>
    {#if label}
      <button
        type="button"
        class="rounded-full px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"
        {disabled}
        onclick={() => void onRemove(revisionId)}
      >Remove name</button>
    {/if}
  </form>
</section>
