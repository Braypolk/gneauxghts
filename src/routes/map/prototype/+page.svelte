<script lang="ts">
  // The surviving Atlas experiment; original /map remains available.
  import { dev } from '$app/environment';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import type { AtlasNode, VaultAtlasResponse } from '$lib/types/atlas';
  import { isTauriRuntime } from '$lib/tauriRuntime';
  import type { NoteSession } from '$lib/features/notepad/model/types';
  import AtlasFusion from '$lib/features/atlas/prototype/AtlasFusion.svelte';
  import { createDemoAtlas } from '$lib/features/atlas/prototype/demo';
  import SearchBar from '$lib/ui/search/SearchBar.svelte';
  import SearchDock from '$lib/ui/search/SearchDock.svelte';
  import { Focus } from '@lucide/svelte';

  let response = $state.raw<VaultAtlasResponse>(createDemoAtlas());
  let activity = $state<{counts:Record<string,number>;countAvailable:boolean;notice:string}>({counts:{},countAvailable:false,notice:''});
  let query = $state('');
  let source = $state<'vault' | 'demo'>('demo');
  let loading = $state(true);
  const native = () => isTauriRuntime() && import.meta.env.VITE_E2E_BROWSER !== 'true';

  async function loadData() {
    try {
      if (native()) {
        response = await invoke<VaultAtlasResponse>('get_vault_atlas', {chatVisibility:'hidden'});
        source = 'vault';
      } else {
        const result = await fetch('/__atlas-prototype/snapshot');
        if (!result.ok) throw new Error('No prototype snapshot server');
        const data = await result.json();
        response = data.response; source = data.source;
        if (data.activity) activity = data.activity;
      }
    } catch {
      response = createDemoAtlas(); source = 'demo';
    } finally { loading = false; }
  }
  async function readSource(node: AtlasNode): Promise<string> {
    if (source === 'demo') return node.preview;
    if (native()) return (await invoke<NoteSession>('read_note', {noteId:node.noteId,path:node.notePath})).markdown;
    const result = await fetch('/__atlas-prototype/command', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'read_note',args:{id:node.id}})});
    if (!result.ok) throw new Error('Read failed');
    return (await result.json()).markdown;
  }
  onMount(() => { if (dev) void loadData(); });
</script>

{#if dev}
  <main class="atlas-preview">
    {#if loading}
      <p class="loading" role="status">Loading your map…</p>
    {:else}
      <AtlasFusion {response} {activity} {query} {readSource}>
        {#snippet search(fitMap)}
          <SearchDock pageInset class="atlas-search-dock">
            <SearchBar class="atlas-search-bar" value={query} placeholder="Find notes" ariaLabel="Search map notes"
              showPlaceholderWhenIdle={true} shortcut={{enabled:true}}
              onValueChange={(value) => query = value}>
              <div class="atlas-map-tools flex shrink-0 items-center gap-0.5 rounded-full border border-border/80 bg-card/88 p-1 text-muted-foreground shadow-lg backdrop-blur-md sm:contents" data-search-focus-independent>
                <button type="button" class="shared-search-control mobile-dense-touch-target" onclick={fitMap} aria-label="Fit map to view" title="Fit view"><Focus class="h-4 w-4" /></button>
              </div>
            </SearchBar>
          </SearchDock>
        {/snippet}
      </AtlasFusion>
      {#if source === 'demo'}<span class="demo-notice">Demo notes</span>{/if}
    {/if}
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
  .demo-notice{position:absolute;top:16px;left:16px;font-size:11px;color:var(--color-muted-foreground);pointer-events:none}
</style>
