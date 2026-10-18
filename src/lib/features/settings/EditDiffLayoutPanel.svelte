<script lang="ts">
  import { editDiffLayout, type EditDiffLayout } from '$lib/editDiffLayout.svelte';
  const options = [
    { id: 'inline', label: 'Inline' },
    { id: 'side-by-side', label: 'Side by side' }
  ] as const satisfies ReadonlyArray<{ id: EditDiffLayout; label: string }>;
</script>

<div class="settings-section" data-settings-anchor="diff-layout">
  <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div>
      <p class="text-sm font-medium">Chat edit diffs</p>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Review edits inline, or compare Before and After side by side.
      </p>
    </div>
    <fieldset class="flex shrink-0 flex-wrap items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1">
      <legend class="sr-only">Chat edit diff layout</legend>
      {#each options as option}
        <label class={`flex cursor-pointer items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
          editDiffLayout.preference === option.id
            ? 'bg-foreground text-background shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}>
          <input class="sr-only" type="radio" name="edit-diff-layout" value={option.id}
            checked={editDiffLayout.preference === option.id}
            onchange={() => editDiffLayout.setPreference(option.id)} />
          <span>{option.label}</span>
        </label>
      {/each}
    </fieldset>
  </div>
</div>
