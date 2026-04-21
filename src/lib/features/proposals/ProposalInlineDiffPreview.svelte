<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    createInlineDiffEditor,
    destroyInlineDiffEditor,
    type InlineDiffEditorController
  } from '$lib/features/proposals/inlineDiffEditor';

  interface Props {
    currentMarkdown: string;
    proposedMarkdown: string;
    emptyMessage?: string;
    frameless?: boolean;
    showRemovedContent?: boolean;
  }

  let {
    currentMarkdown,
    proposedMarkdown,
    emptyMessage = 'No note body changes selected.',
    frameless = false,
    showRemovedContent = true
  }: Props = $props();

  let editorRoot = $state<HTMLDivElement | null>(null);
  let editorController: InlineDiffEditorController | null = null;
  let mounted = false;
  let lastSignature = '';
  let syncGeneration = 0;

  function previewSignature() {
    return `${currentMarkdown}\u0000${proposedMarkdown}`;
  }

  async function syncPreview() {
    const generation = ++syncGeneration;

    if (!mounted || !editorRoot || currentMarkdown === proposedMarkdown) {
      editorController = await destroyInlineDiffEditor(editorController);
      if (editorRoot) {
        editorRoot.innerHTML = '';
      }
      lastSignature = '';
      return;
    }

    const nextSignature = previewSignature();
    if (editorController && nextSignature === lastSignature) {
      return;
    }

    editorController = await destroyInlineDiffEditor(editorController);
    editorRoot.innerHTML = '';
    const nextController = await createInlineDiffEditor({
      editorRoot,
      currentMarkdown,
      proposedMarkdown,
      showRemovedContent
    });

    if (generation !== syncGeneration || !mounted || !editorRoot) {
      await destroyInlineDiffEditor(nextController);
      return;
    }

    editorController = nextController;
    lastSignature = nextSignature;
  }

  onMount(() => {
    mounted = true;
  });

  onDestroy(() => {
    mounted = false;
    syncGeneration += 1;
    void destroyInlineDiffEditor(editorController);
  });

  $effect(() => {
    currentMarkdown;
    proposedMarkdown;
    showRemovedContent;
    editorRoot;

    if (mounted) {
      void syncPreview();
    }
  });
</script>

{#if currentMarkdown === proposedMarkdown}
  <p class="mt-4 text-sm text-muted-foreground">{emptyMessage}</p>
{:else}
  <div class={`proposal-inline-diff-shell mt-4 overflow-hidden ${
    frameless ? '' : 'rounded-2xl border border-border/70 bg-background/80'
  }`}>
    <div bind:this={editorRoot} class="proposal-inline-diff"></div>
  </div>
{/if}

<style>
  .proposal-inline-diff-shell {
    min-height: 0;
  }

  .proposal-inline-diff :global(.cm-editor.cm-draftly) {
    min-height: 0;
    background: transparent;
    color: var(--foreground);
    line-height: 1.75;
    cursor: default;
  }

  .proposal-inline-diff :global(.cm-editor.cm-draftly:focus) {
    outline: none;
  }

  .proposal-inline-diff :global(.proposal-inline-diff__added) {
    border-radius: 0.3rem;
    background: color-mix(in oklab, #ecd444 36%, transparent);
    box-shadow: inset 0 -1px 0 color-mix(in oklab, #ecd444 62%, transparent);
  }

  .proposal-inline-diff :global(.proposal-inline-diff__removed) {
    display: inline;
    margin-right: 0.08rem;
    border-radius: 0.3rem;
    background: color-mix(in oklab, #f1d9a0 55%, transparent);
    color: color-mix(in oklab, var(--foreground) 88%, #6f5d00);
    text-decoration: line-through;
    text-decoration-thickness: 0.08em;
    white-space: pre-wrap;
  }

  .proposal-inline-diff :global(.proposal-inline-diff__removed-block) {
    display: block;
    margin: 0.6rem 0;
    padding: 0.15rem 0;
  }

  .proposal-inline-diff :global(.proposal-inline-diff__removed-block *),
  .proposal-inline-diff :global(.proposal-inline-diff__removed-block li::marker) {
    text-decoration: line-through;
    text-decoration-thickness: 0.08em;
  }
</style>
