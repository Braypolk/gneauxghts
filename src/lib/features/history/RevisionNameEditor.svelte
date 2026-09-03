<script lang="ts">
  import { untrack } from 'svelte';

  let {
    revisionId,
    label,
    disabled,
    onSave,
    onRemove
  }: {
    revisionId: string;
    label: string | null;
    disabled: boolean;
    onSave: (revisionId: string, label: string) => void | Promise<void>;
    onRemove: (revisionId: string) => void | Promise<void>;
  } = $props();

  let draft = $state(untrack(() => label ?? ''));

  function save(event: SubmitEvent) {
    event.preventDefault();
    const nextLabel = draft.trim();
    if (!nextLabel) return;
    void onSave(revisionId, nextLabel);
  }
</script>

<section class="mb-5 rounded-2xl border border-border/70 bg-muted/20 p-4" aria-label="Named Revision">
  <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Named Revision</p>
  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
    Add a durable name to this revision. Duplicate names are allowed; its revision identity stays unchanged.
  </p>
  <form class="mt-3 flex flex-col gap-2 sm:flex-row" onsubmit={save}>
    <input
      class="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
      aria-label="Revision name"
      placeholder="Name this revision"
      bind:value={draft}
      {disabled}
    />
    <button
      type="submit"
      class="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      disabled={disabled || draft.trim() === '' || draft.trim() === label}
    >
      {label ? 'Save name' : 'Add name'}
    </button>
    {#if label}
      <button
        type="button"
        class="rounded-full border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        {disabled}
        onclick={() => void onRemove(revisionId)}
      >Remove name</button>
    {/if}
  </form>
</section>
