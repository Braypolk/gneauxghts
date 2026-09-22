<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { X } from '@lucide/svelte';

  let { tags, error, disabled = false, onChange, onDone }: {
    tags: string[];
    error?: string;
    disabled?: boolean;
    onChange: (tags: string[]) => void;
    onDone: () => void;
  } = $props();
  const id = $props.id();
  let value = $state('');
  let editing = $state<string | null>(null);
  let editValue = $state('');
  let validation = $state('');
  let suggestions = $state<string[]>([]);
  let renameInput = $state<HTMLInputElement | null>(null);
  let row = $state<HTMLDivElement | null>(null);
  const unavailable = $derived(disabled || Boolean(error));
  onMount(() => {
    let active = true;
    void invoke<string[]>('list_note_tags').then((tags) => {
      if (active) suggestions = tags;
    }).catch(() => { /* Suggestions are optional; authored tags remain editable. */ });
    return () => { active = false; };
  });
  function normalized(raw: string) {
    const tag = raw.trim().replace(/^#+/, '').toLowerCase();
    if (!tag || unavailable) return null;
    if (Array.from(tag).length > 80 || !/^[\p{L}\p{N}_/-]+$/u.test(tag)) {
      validation = 'Use letters, numbers, hyphens, underscores or / (up to 80 characters).';
      return null;
    }
    validation = '';
    return tag;
  }
  function commitNew() {
    const tag = normalized(value);
    if (!tag) return;
    onChange([...new Set([...tags, tag])].sort());
    value = '';
  }
  async function focusChip(tag: string) {
    await tick();
    const chip = Array.from(row?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.getAttribute('aria-label') === `Edit tag ${tag}`);
    chip?.focus();
  }
  function commitRename(restoreFocus = false) {
    if (!editing) return;
    const tag = normalized(editValue);
    if (!tag) return;
    onChange([...new Set([...tags.filter((tag) => tag !== editing), tag])].sort());
    editing = null;
    editValue = '';
    if (restoreFocus) void focusChip(tag);
  }
  async function edit(tag: string) {
    editing = tag;
    editValue = tag;
    validation = '';
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }
</script>

<div bind:this={row} class="note-tags-lane relative flex flex-wrap items-center gap-1.5 pb-4 pt-1 text-xs text-muted-foreground" role="group" aria-label="Note tags" data-testid="note-tags">
  {#each tags as tag (tag)}
    <span class="inline-flex max-w-full items-center rounded-full border border-border/60 bg-muted/35 focus-within:border-ring/60 focus-within:ring-1 focus-within:ring-ring/40">
      {#if editing === tag}
        <span class="pl-2.5" aria-hidden="true">#</span>
        <input bind:this={renameInput} bind:value={editValue} class="min-w-0 rounded bg-transparent py-1 outline-none" style:width={`${Math.max(3, tag.length, editValue.length)}ch`} aria-label={`Rename tag ${tag}`} aria-invalid={Boolean(validation)} aria-describedby={validation ? `${id}-error` : undefined} disabled={unavailable}
          onblur={() => commitRename()} onkeydown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitRename(true); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing = null; editValue = ''; validation = ''; void focusChip(tag); }
          }} />
      {:else}
        <button type="button" class="min-w-0 cursor-pointer disabled:cursor-default truncate rounded-l-full px-2.5 py-1 hover:text-foreground outline-none" disabled={unavailable} aria-label={`Edit tag ${tag}`} onclick={() => void edit(tag)}>#{tag}</button>
      {/if}
      <button type="button" class="shrink-0 cursor-pointer disabled:cursor-default rounded-full p-1.5 hover:bg-accent hover:text-foreground outline-none" disabled={unavailable} aria-label={`Remove tag ${tag}`} onmousedown={(event) => event.preventDefault()} onclick={() => {
        if (editing === tag) { editing = null; editValue = ''; validation = ''; }
        onChange(tags.filter((item) => item !== tag));
      }}><X class="h-3 w-3" /></button>
    </span>
  {/each}
  <input bind:value list={`${id}-suggestions`} class="w-32 max-w-full shrink-0 cursor-pointer focus:cursor-text disabled:cursor-default rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-border focus:bg-background/60 disabled:opacity-50" placeholder="+ Add tag" aria-label="Add tag" aria-invalid={Boolean(validation && !editing)} aria-describedby={error || validation ? `${id}-error` : undefined} disabled={unavailable}
    onblur={commitNew} onkeydown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); commitNew(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); value = ''; validation = ''; onDone(); }
    }} />
  <datalist id={`${id}-suggestions`}>
    {#each suggestions.filter((tag) => !tags.includes(tag)) as tag (tag)}<option value={tag}></option>{/each}
  </datalist>
  {#if error || validation}<p id={`${id}-error`} class="w-full text-xs text-destructive" role="status">{error || validation}</p>{/if}
</div>
