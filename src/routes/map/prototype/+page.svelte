<script lang="ts">
  // The surviving Atlas experiment; original /map remains available.
  import { dev } from '$app/environment';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { atlasStore } from '$lib/features/atlas/atlasStore.svelte';
  import { storePendingNoteTarget } from '$lib/noteNavigation';
  import type { AtlasNode } from '$lib/types/atlas';
  import type { NoteSession } from '$lib/features/notepad/model/types';
  import AtlasFusion from '$lib/features/atlas/prototype/AtlasFusion.svelte';
  import SearchBar from '$lib/ui/search/SearchBar.svelte';
  import SearchDock from '$lib/ui/search/SearchDock.svelte';
  import { Focus } from '@lucide/svelte';

  const atlas = atlasStore;
  const matchingIds = $derived(new Set(atlas.visibleNodes.filter(node => atlas.nodeHasSearchHit(node)).sort((a, b) => (atlas.searchMatchForNode(b)?.score ?? 0) - (atlas.searchMatchForNode(a)?.score ?? 0)).map(node => node.id)));
  const searchReady = $derived(atlas.searchResponse?.query === atlas.searchQuery.trim() && atlas.searchResponse.status === 'ready' && !atlas.isSearching);
  async function readSource(node: AtlasNode): Promise<string> {
    return (await invoke<NoteSession>('read_note', { noteId: node.noteId, path: node.notePath })).markdown;
  }
  async function openNode(node: AtlasNode) {
    storePendingNoteTarget({ noteId: node.noteId, notePath: node.notePath, documentKind: node.documentKind });
    await goto(resolve('/'));
  }
  onMount(() => {
    if (dev) void atlas.initialize();
    return () => atlas.dispose();
  });
</script>

{#if dev}
  <main class="atlas-preview">
    {#if atlas.response?.nodes.length}
      <AtlasFusion response={atlas.response} query={atlas.searchQuery} selectedNodeId={atlas.selectedNodeId} selectNode={(node) => atlas.selectNode(node)} {matchingIds} {readSource} {openNode}>
        {#snippet search(fitMap)}
          <SearchDock pageInset class="atlas-search-dock">
            <SearchBar class="atlas-search-bar" value={atlas.searchQuery} placeholder="Find notes" ariaLabel="Search map notes"
              showPlaceholderWhenIdle={true} shortcut={{enabled:true}}
              onValueChange={(value) => atlas.setSearchQuery(value)}>
              <div class="atlas-map-tools flex shrink-0 items-center gap-0.5 rounded-full border border-border/80 bg-card/88 p-1 text-muted-foreground shadow-lg backdrop-blur-md sm:contents" data-search-focus-independent>
                <button type="button" class="shared-search-control mobile-dense-touch-target" onclick={fitMap} aria-label="Fit map to view" title="Fit view"><Focus class="h-4 w-4" /></button>
              </div>
            </SearchBar>
          </SearchDock>
        {/snippet}
      </AtlasFusion>
    {:else}
      <div class="loading" role="status">
        <strong>{atlas.error ? 'Map unavailable' : atlas.response?.status === 'empty' ? 'No map yet' : atlas.response?.status === 'unavailable' ? 'Semantic map unavailable' : atlas.response?.status === 'building' ? 'Building your map' : 'Loading your map…'}</strong>
        <p>{atlas.error ?? atlas.response?.reason ?? ''}</p>
        {#if atlas.error}<button onclick={() => void atlas.refresh()}>Retry</button>{/if}
        {#if atlas.response?.status === 'unavailable'}<button onclick={() => void goto(resolve('/settings'))}>Open Settings</button>{/if}
      </div>
    {/if}
    {#if atlas.response?.nodes.length && (atlas.isRevalidating || atlas.error)}
      <span class="map-status" role="status">{atlas.error ? 'Map update failed' : 'Updating map'}{#if atlas.error}<button onclick={() => void atlas.refresh()}>Retry</button>{/if}</span>
    {/if}
    {#if atlas.searchQuery.trim()}<span class="search-status" role="status">{atlas.searchError || atlas.searchResponse?.status === 'unavailable' ? 'Search unavailable' : !searchReady ? 'Searching…' : `${matchingIds.size} matching notes`}{#if atlas.searchError}<button onclick={() => void atlas.runSearch()}>Retry</button>{/if}</span>{/if}
  </main>
{:else}
  <p>The Atlas preview runs in development with <code>pnpm atlas:lab</code>.</p>
{/if}

<style>
  .atlas-preview{position:relative;height:100%;width:100%;min-height:0;overflow:hidden;color:var(--color-foreground)}
  .loading{position:absolute;inset:0;display:grid;place-content:center;font-size:14px;color:var(--color-muted-foreground)}
  :global(.atlas-preview .atlas-search-bar > svg){display:block}
  @media(min-width:640px) and (max-width:699px){
    :global(.atlas-preview .atlas-search-bar[data-search-expanded='false']){max-width:calc(100vw - 13.875rem)}
  }
  @media(min-width:640px) and (max-width:699px) and (max-height:559px){
    :global(.atlas-preview .atlas-search-bar[data-search-expanded='false']){max-width:calc(100vw - 10.875rem)}
  }
  @media(max-width:639px){
    :global(.atlas-preview .atlas-search-bar[data-search-expanded='false']){max-width:calc(100vw - 8.75rem)}
    .atlas-map-tools{position:absolute;right:0;bottom:calc(100% + .5rem)}
  }
  .map-status,.search-status{position:absolute;bottom:16px;left:16px;font-size:11px;color:var(--color-muted-foreground);}
  .search-status{bottom:44px}.loading{text-align:center;gap:12px;padding:24px}.loading strong{font-weight:600}.loading button,.map-status button{border:1px solid var(--color-border);border-radius:8px;padding:5px 10px;margin-left:8px}
</style>
