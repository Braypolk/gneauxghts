<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { activeNoteDraft, requestNoteOpen } from '$lib/stores/semantic';
  import type { RelatedItem, SemanticStatus } from '$lib/types/semantic';

  interface Props {
    open?: boolean;
    onToggle?: () => void;
  }

  let { open = false, onToggle }: Props = $props();

  const relatedCardClass =
    'rounded-3xl border border-transparent bg-background p-5 text-left transition-colors hover:border-border hover:bg-accent';

  let relatedItems = $state<RelatedItem[]>([]);
  let semanticStatus = $state<SemanticStatus | null>(null);
  let isLoading = $state(false);
  let activeRequest = 0;
  let refreshTimer: ReturnType<typeof window.setTimeout> | null = null;

  function scheduleRefresh() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void loadRelated();
    }, 220);
  }

  async function loadStatus() {
    try {
      semanticStatus = await invoke<SemanticStatus>('get_semantic_status');
    } catch (error) {
      console.error('Failed to load semantic status:', error);
    }
  }

  async function loadRelated() {
    const draft = $activeNoteDraft;
    if (draft.markdown.trim() === '' && draft.path === null) {
      relatedItems = [];
      return;
    }

    const requestId = ++activeRequest;
    isLoading = true;

    try {
      const items = await invoke<RelatedItem[]>('get_related_notes', {
        currentPath: draft.path,
        currentMarkdown: draft.markdown,
        limit: 6
      });

      if (requestId !== activeRequest) return;
      relatedItems = items;
    } catch (error) {
      if (requestId !== activeRequest) return;
      console.error('Failed to load related notes:', error);
      relatedItems = [];
    } finally {
      if (requestId === activeRequest) {
        isLoading = false;
      }
    }
  }

  function openRelated(item: RelatedItem) {
    requestNoteOpen({
      notePath: item.notePath,
      sectionLabel: item.sectionLabel,
      matchText: item.matchText,
      startLine: item.startLine,
      endLine: item.endLine
    });
  }

  function formatScore(score: number) {
    return `${Math.round(score * 100)}%`;
  }

  onMount(() => {
    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
      if (open) {
        void loadRelated();
      }
    }, 4000);

    return () => {
      window.clearInterval(interval);
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  });

  $effect(() => {
    $activeNoteDraft;
    scheduleRefresh();
  });

  $effect(() => {
    if (open) {
      void loadStatus();
      scheduleRefresh();
    }
  });
</script>

{#snippet RelatedBody()}
  {#if semanticStatus?.settings.relatedSidebarEnabled === false}
    <div class="rounded-3xl border border-dashed border-border bg-background px-5 py-6 text-sm text-muted-foreground">
      Related sidebar is disabled in Settings.
    </div>
  {:else if semanticStatus?.indexingInProgress}
    <div class="rounded-3xl border border-border/70 bg-background px-5 py-6 text-sm text-muted-foreground">
      {semanticStatus.currentJobLabel ?? 'Indexing semantic data'}…
    </div>
  {:else if semanticStatus?.lastError}
    <div class="rounded-3xl border border-rose-300/60 bg-rose-50 px-5 py-6 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
      {semanticStatus.lastError}
    </div>
  {:else if isLoading}
    <div class="rounded-3xl border border-border/70 bg-background px-5 py-6 text-sm text-muted-foreground">
      Looking for neighboring notes…
    </div>
  {:else if relatedItems.length === 0}
    <div class="rounded-3xl border border-dashed border-border bg-background px-5 py-6 text-sm text-muted-foreground">
      No strong related notes yet. Save or keep writing to give the index more context.
    </div>
  {:else}
    {#each relatedItems as item}
      <button class="{relatedCardClass} cursor-pointer" type="button" onclick={() => openRelated(item)}>
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <h4 class="font-semibold">{item.noteTitle}</h4>
            {#if item.sectionLabel}
              <p class="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.sectionLabel}</p>
            {/if}
          </div>
          <span class="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {formatScore(item.score)}
          </span>
        </div>
        <p class="text-sm text-muted-foreground leading-relaxed">{item.excerpt}</p>
        <p class="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{item.reasonLabel}</p>
      </button>
    {/each}
  {/if}
{/snippet}

<div class="relative hidden min-[950px]:flex flex-none transition-all duration-500 ease-in-out h-full items-start {open ? 'w-[340px] opacity-100' : 'w-0 opacity-0'}">
  <div class="absolute right-0 top-0 bottom-0 w-[340px] bg-card text-card-foreground rounded-[2rem] shadow-sm border border-border flex flex-col overflow-hidden transition-transform duration-500 ease-in-out {open ? 'translate-x-0' : 'translate-x-full'}">
    <div class="p-8 pb-4 shrink-0 flex items-center justify-center relative">
      <div class="text-center">
        <h3 class="font-medium text-lg">Related</h3>
        {#if semanticStatus}
          <p class="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {semanticStatus.indexedNotes} notes · {semanticStatus.indexedChunks} chunks
          </p>
        {/if}
      </div>
      <button class="absolute right-6 top-8 rounded-full bg-muted p-1.5 text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground" onclick={onToggle} aria-label="Close Related" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
      {@render RelatedBody()}
    </div>
  </div>
</div>

{#if !open}
  <div
    class="fixed right-0 top-1/2 -translate-y-1/2 w-4 h-32 rounded-l-xl border border-r-0 border-border bg-card shadow-md cursor-pointer transition-all hover:w-6 hover:bg-muted items-center justify-center group z-20 hidden min-[950px]:flex"
    onclick={onToggle}
    title="Open Related"
    role="button"
    tabindex="0"
    onkeydown={(event) => event.key === 'Enter' && onToggle?.()}
  >
    <div class="w-1 h-10 rounded-full bg-border group-hover:bg-muted-foreground/55 transition-colors"></div>
  </div>
{/if}

<div
  class="relative w-full flex-none min-[950px]:hidden overflow-visible transition-all duration-500 ease-in-out {open ? 'h-[min(360px,55vh)] pt-4' : 'h-0 pt-0'}"
>
  <div
    class="absolute inset-x-0 bottom-0 h-[min(360px,55vh)] bg-card text-card-foreground rounded-[2rem] shadow-sm border border-border flex flex-col overflow-hidden transition-all duration-500 ease-in-out {open ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}"
  >
    <div class="p-8 pb-4 shrink-0 flex items-center justify-center relative">
      <div class="text-center">
        <h3 class="font-medium text-lg">Related</h3>
        {#if semanticStatus}
          <p class="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {semanticStatus.indexedNotes} notes · {semanticStatus.indexedChunks} chunks
          </p>
        {/if}
      </div>
      <button class="absolute right-6 top-8 rounded-full bg-muted p-1.5 text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground" onclick={onToggle} aria-label="Close Related" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
      {@render RelatedBody()}
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
