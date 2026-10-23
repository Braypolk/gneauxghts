<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { atlasStore } from '#lib/features/atlas/atlasStore.svelte.js';
  import { storePendingNoteTarget } from '#lib/noteNavigation.js';
  import type { AtlasNode } from '#lib/types/atlas.js';
  import type { NoteSession } from '#lib/features/notepad/model/types.js';
  import AtlasMap from '#lib/features/atlas/AtlasMap.svelte';
  import AtlasSearch from '#lib/features/atlas/AtlasSearch.svelte';

  const atlas = atlasStore;
  const matchingIds = $derived(atlas.matchingNodeIds);
  const searchReady = $derived(atlas.searchResponse?.query === atlas.searchQuery.trim() && ['ready', 'empty'].includes(atlas.searchResponse.status) && !atlas.isSearching);
  async function readSource(node: AtlasNode): Promise<string> {
    return (await invoke<NoteSession>('read_note', { noteId: node.noteId, path: node.notePath })).markdown;
  }
  async function openNode(node: AtlasNode) {
    storePendingNoteTarget({ noteId: node.noteId, notePath: node.notePath, documentKind: node.documentKind });
    await goto(resolve('/'));
  }
  onMount(() => {
    void atlas.initialize();
    return () => atlas.dispose();
  });
</script>

<main class="atlas-surface">
  {#if atlas.response?.nodes.length}
    <AtlasMap
      response={atlas.response}
      query={atlas.searchQuery}
      selectedNodeId={atlas.selectedNodeId}
      selectNode={(node) => atlas.selectNode(node)}
      matchingIds={matchingIds}
      readSource={readSource}
      openNode={openNode}
      renameCloud={(id, name) => atlas.renameCloud(id, name)}
    >
      {#snippet search(fitMap)}
        <AtlasSearch {atlas} {fitMap} />
      {/snippet}
    </AtlasMap>
  {:else}
    <div class="loading" role="status">
        <strong>{atlas.error ? 'Map unavailable' : atlas.response?.status === 'empty' ? 'No map yet' : atlas.response?.status === 'unavailable' ? 'Semantic map unavailable' : atlas.response?.status === 'building' ? 'Building your map' : 'Loading your map…'}</strong>
      <p>{atlas.error ?? atlas.response?.reason ?? ''}</p>

      {#if atlas.error}
        <button onclick={() => void atlas.refresh()}>Retry</button>
      {/if}

      {#if atlas.response?.status === 'unavailable'}
        <button onclick={() => void goto(resolve('settings'))}>Open Settings</button>
      {/if}
    </div>
  {/if}
  {#if atlas.response?.nodes.length && (atlas.isRevalidating || atlas.error)}
    <span class="map-status" role="status">
      {atlas.error ? 'Map update failed' : 'Updating map'}{#if atlas.error}
        <button onclick={() => void atlas.refresh()}>Retry</button>
      {/if}
    </span>
  {/if}

  {#if atlas.searchQuery.trim()}
    <span class="search-status" role="status">
      {atlas.searchError || atlas.searchResponse?.status === 'unavailable'
        ? 'Search unavailable'
        : !searchReady ? 'Searching…' : `${matchingIds.size} matching node${matchingIds.size === 1 ? '' : 's'}`}{#if atlas.searchError || atlas.searchResponse?.status === 'unavailable'}
        <button onclick={() => void atlas.runSearch()}>Retry</button>
      {/if}
    </span>
  {/if}
</main>

<style>
  .atlas-surface {
    position: relative;
    height: 100%;
    width: 100%;
    min-height: 0;
    overflow: hidden;
    color: var(--color-foreground);
  }

  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    font-size: 14px;
    color: var(--color-muted-foreground);
  }

  :global(.atlas-surface .atlas-search-bar > svg) {
    display: block;
  }

  @media (min-width:640px) and (max-width:699px) {
    :global(.atlas-surface .atlas-search-bar[data-search-expanded="false"]) {
      max-width: calc(100vw - 13.875rem);
    }
  }

  @media (min-width:640px) and (max-width:699px) and (max-height:559px) {
    :global(.atlas-surface .atlas-search-bar[data-search-expanded="false"]) {
      max-width: calc(100vw - 10.875rem);
    }
  }

  @media (max-width:639px) {
    :global(.atlas-surface .atlas-search-bar[data-search-expanded="false"]) {
      max-width: calc(100vw - 8.75rem);
    }
  }

  .map-status,
  .search-status {
    position: absolute;
    bottom: 16px;
    left: 16px;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }

  .search-status {
    bottom: 44px;
  }

  .loading {
    text-align: center;
    gap: 12px;
    padding: 24px;
  }

  .loading strong {
    font-weight: 600;
  }

  .loading button,
  .map-status button {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 5px 10px;
    margin-left: 8px;
  }
</style>
