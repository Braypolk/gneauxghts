<script lang="ts">
  // Four throwaway Atlas alternatives on /map/prototype?variant=…; baseline /map stays intact.
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import type { AtlasNode, VaultAtlasResponse } from '$lib/types/atlas';
  import { isTauriRuntime } from '$lib/tauriRuntime';
  import type { NoteSession } from '$lib/features/notepad/model/types';
  import TopicTreemap from '$lib/features/atlas/prototype/TopicTreemap.svelte';
  import RelationshipMatrix from '$lib/features/atlas/prototype/RelationshipMatrix.svelte';
  import IdeaWeave from '$lib/features/atlas/prototype/IdeaWeave.svelte';
  import TopicTimePlot from '$lib/features/atlas/prototype/TopicTimePlot.svelte';
  import { createDemoAtlas } from '$lib/features/atlas/prototype/demo';
  import { matchesQuery } from '$lib/features/atlas/prototype/types';

  const variants = [
    {key:'treemap',name:'Treemap',letter:'A'},
    {key:'matrix',name:'Relationship matrix',letter:'B'},
    {key:'weave',name:'Idea weave',letter:'C'},
    {key:'time',name:'Topic × time',letter:'D'}
  ];
  let current = $derived(variants.find(v => v.key === page.url.searchParams.get('variant')) || variants[0]);
  let response = $state.raw<VaultAtlasResponse>(createDemoAtlas());
  let selectedIds = $state<string[]>([]);
  let query = $state('');
  let tagLens = $state('');
  let topicLens = $state('');
  let tags = $derived([...new Set(response.nodes.flatMap(node => node.tags.map(tag => tag.replace(/^#/, ''))))].sort((a,b) => a.localeCompare(b)));
  let topics = $derived(response.clouds.filter(cloud => !cloud.parentId));
  let effectiveQuery = $derived([query, tagLens ? `tag:"${tagLens}"` : '', topicLens ? `topic:${topicLens}` : ''].filter(Boolean).join(' '));
  let source = $state<'vault'|'demo'>('demo');
  let notice = $state('');
  let loading = $state(true);
  let resetEpoch = $state(0);
  let panel = $state<'none'|'set'|'preview'>('none');
  let previewNode = $state<AtlasNode|null>(null);
  let body = $state('');
  let bodyLoading = $state(false);
  let previewSequence = 0;
  let setTitle = $state('My collected ideas');
  let exportText = $state('');
  let copyStatus = $state('');
  const native = () => isTauriRuntime() && import.meta.env.VITE_E2E_BROWSER !== 'true';
  let selectedNodes = $derived(response.nodes.filter(node => selectedIds.includes(node.id)));
  let matches = $derived(response.nodes.filter(node => matchesQuery(node,effectiveQuery)).length);

  function toggle(id: string) {
    selectedIds = selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds,id];
    exportText = ''; copyStatus = '';
  }
  function addMany(ids: string[]) {
    selectedIds = [...new Set([...selectedIds,...ids])]; exportText = ''; copyStatus = '';
  }
  async function loadData(demo = false) {
    loading = true;
    try {
      if (demo) {
        response = createDemoAtlas(); source = 'demo'; notice = 'Fictional notes and relationships for trying the interactions.';
      } else if (native()) {
        response = await invoke<VaultAtlasResponse>('get_vault_atlas', {chatVisibility:'hidden'});
        source = 'vault'; notice = response.stale ? 'Showing the last published Atlas while the app rebuilds.' : 'Read-only snapshot from the running vault.';
      } else {
        const result = await fetch('/__atlas-prototype/snapshot');
        if (!result.ok) throw new Error('No prototype snapshot server');
        const data = await result.json();
        response = data.response; source = data.source; notice = data.notice || 'Frozen vault snapshot. Original and alternatives use the same notes.';
      }
      selectedIds = []; panel = 'none'; query = ''; tagLens = ''; topicLens = ''; exportText = ''; previewSequence++; resetEpoch++;
    } catch {
      response = createDemoAtlas(); source = 'demo'; notice = 'Vault snapshot unavailable. Showing a fictional demo; run pnpm atlas:lab to compare your vault.';
    } finally { loading = false; }
  }
  async function preview(node: AtlasNode) {
    const sequence = ++previewSequence;
    previewNode = node; panel = 'preview'; body = node.preview; bodyLoading = false;
    if (source === 'demo') return;
    bodyLoading = true;
    try {
      let session: NoteSession;
      if (native()) session = await invoke<NoteSession>('read_note', {noteId:node.noteId,path:node.notePath});
      else {
        const result = await fetch('/__atlas-prototype/command', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'read_note',args:{id:node.id}})});
        if (!result.ok) throw new Error('Read failed');
        session = await result.json();
      }
      if (sequence === previewSequence) body = session.markdown;
    } catch { if (sequence === previewSequence) body = `${node.preview}\n\n[Full note unavailable; showing the indexed excerpt.]`; }
    finally { if (sequence === previewSequence) bodyLoading = false; }
  }
  function cycle(direction: number) {
    const next = variants[(variants.indexOf(current) + direction + variants.length) % variants.length];
    const url = new URL(page.url); url.searchParams.set('variant',next.key);
    void goto(url.pathname + url.search, {replaceState:true,noScroll:true,keepFocus:true});
  }
  function keyboard(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !(event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],svg')) return;
    event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1);
  }
  function makeExport() {
    exportText = `# ${setTitle}\n\n${selectedNodes.length} sources collected in Atlas lab (${source === 'demo' ? 'fictional demo' : 'vault snapshot'}).\n\n` + selectedNodes.map(node => `## ${node.title}\n\nSource: ${node.notePath}\n\n${node.preview}\n`).join('\n');
    return exportText;
  }
  async function copySet() {
    const text = makeExport();
    try { await navigator.clipboard.writeText(text); copyStatus = 'Copied source list and excerpts.'; }
    catch { copyStatus = 'Select and copy the text below.'; }
  }
  function downloadSet() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([makeExport()],{type:'text/markdown'}));
    link.download = 'atlas-working-set.md'; link.click(); URL.revokeObjectURL(link.href);
    copyStatus = 'Downloaded source list and excerpts.';
  }
  onMount(() => { if (dev) void loadData(); });
</script>

<svelte:window onkeydown={keyboard} />

{#if dev}
  <main class="atlas-lab">
    <header class="lab-header">
      <span class="lab-title">Atlas <b>visualization lab</b></span>
      <span class="snapshot" title={notice}><i class:demo={source === 'demo'}></i>{source === 'vault' ? 'Your vault' : 'Demo'} · {response.nodes.length} notes · {response.links.length} relationships</span>
      <div class="tools">
        <button onclick={() => void loadData(source !== 'demo')}>{source === 'demo' ? 'Use vault' : 'Demo data'}</button>
        <button onclick={() => void loadData(source === 'demo')}>Reset</button>
        <a class="baseline" href={source === 'demo' ? '/map?atlasPrototypeSource=demo' : '/map'} target="_blank" rel="noreferrer">Original Atlas ↗</a>
      </div>
    </header>
    <div class="filter-bar">
      <input aria-label="Highlight notes" type="search" placeholder="Highlight text, #tag or tag:name…" bind:value={query} />
      <select aria-label="Topic lens" bind:value={topicLens}><option value="">All ideas</option>{#each topics as topic}<option value={topic.id}>{topic.label || 'Unlabelled topic'}</option>{/each}</select>
      <select aria-label="Tag lens" bind:value={tagLens} disabled={!tags.length}><option value="">{tags.length ? 'All tags' : 'No indexed tags'}</option>{#each tags as tag}<option value={tag}>{tag}</option>{/each}</select>
      {#if effectiveQuery}<button aria-label="Clear filters" onclick={() => {query='';tagLens='';topicLens='';}}>✕</button>{/if}
      <span class="match-count">{matches} / {response.nodes.length} highlighted</span>
      <button class="set-button" onclick={() => panel = panel === 'set' ? 'none' : 'set'}>Selection <b>{selectedIds.length}</b></button>
    </div>
    {#if loading}<div class="loading">Loading comparison snapshot…</div>{:else}
      <div class="experiment-space">
        <div class="variants">
          {#key resetEpoch}
          <div class="variant" hidden={current.key !== 'treemap'}><TopicTreemap {response} {selectedIds} query={effectiveQuery} onToggle={toggle} onAddMany={addMany} onPreview={preview}/></div>
          <div class="variant" hidden={current.key !== 'matrix'}><RelationshipMatrix {response} {selectedIds} query={effectiveQuery} onToggle={toggle} onAddMany={addMany} onPreview={preview}/></div>
          <div class="variant" hidden={current.key !== 'weave'}><IdeaWeave {response} {selectedIds} query={effectiveQuery} onToggle={toggle} onAddMany={addMany} onPreview={preview}/></div>
          <div class="variant" hidden={current.key !== 'time'}><TopicTimePlot {response} {selectedIds} query={effectiveQuery} onToggle={toggle} onAddMany={addMany} onPreview={preview}/></div>
          {/key}
        </div>
        {#if panel !== 'none'}
          <aside class="reader" aria-label={panel === 'set' ? 'Selected notes' : 'Read-only source preview'}>
            <div class="reader-heading"><span class="eyebrow">{panel === 'set' ? 'Selected sources' : 'Read-only source'}</span><button aria-label="Close panel" onclick={() => panel = 'none'}>✕</button></div>
            {#if panel === 'preview' && previewNode}
              <h2>{previewNode.title}</h2><p class="source-path">{previewNode.notePath}</p>
              <button class="primary" onclick={() => toggle(previewNode!.id)}>{selectedIds.includes(previewNode.id) ? 'Remove from selection' : 'Add to selection'}</button>
              {#if bodyLoading}<p class="notice">Reading full source…</p>{/if}
              <pre class="source-body">{body}</pre>
            {:else}
              <input class="set-title" aria-label="Selection name" bind:value={setTitle}/>
              <p class="set-help">The same selection is highlighted in all four visualizations.</p>
              <div class="set-actions"><button disabled={!selectedNodes.length} onclick={() => void copySet()}>Copy excerpts</button><button disabled={!selectedNodes.length} onclick={downloadSet}>Download .md</button><button disabled={!selectedNodes.length} onclick={() => {selectedIds=[];exportText='';copyStatus='';}}>Clear</button></div>
              {#if copyStatus}<p class="notice" role="status">{copyStatus}</p>{/if}
              {#if !selectedNodes.length}<div class="empty">Select notes in a visualization to inspect them together here.</div>{/if}
              {#each selectedNodes as node (node.id)}<article class="collected"><div><button class="note-title" onclick={() => void preview(node)}>{node.title}</button><button aria-label={`Remove ${node.title}`} onclick={() => toggle(node.id)}>−</button></div><p>{node.preview}</p><small>{node.fileName}</small></article>{/each}
              {#if exportText}<textarea class="export" aria-label="Exported source list" readonly value={exportText}></textarea>{/if}
            {/if}
          </aside>
        {/if}
      </div>
    {/if}
    <nav class="switcher" aria-label="Prototype variants">
      <button class="arrow" aria-label="Previous variant" onclick={() => cycle(-1)}>←</button>
      {#each variants as variant}<button class:active={variant.key === current.key} aria-label={`${variant.letter} ${variant.name}`} aria-current={variant.key === current.key ? 'page' : undefined} onclick={() => {const url=new URL(page.url);url.searchParams.set('variant',variant.key);void goto(url.pathname+url.search,{replaceState:true,noScroll:true});}}><b>{variant.letter}</b><span>{variant.name}</span></button>{/each}
      <button class="arrow" aria-label="Next variant" onclick={() => cycle(1)}>→</button>
    </nav>
  </main>
{:else}
  <p class="production-message">The Atlas visualization lab runs in development. Start it with <code>pnpm atlas:lab</code>.</p>
{/if}

<style>
  .atlas-lab{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--foreground);padding:0 8px 70px;gap:8px;font-size:12px}
  .lab-header{display:flex;align-items:center;gap:16px;padding:10px 2px 5px;flex-shrink:0;flex-wrap:wrap}.lab-title{font-size:14px;white-space:nowrap}.lab-title b{font-size:11px;font-weight:500;color:var(--muted-foreground);margin-left:7px}.snapshot{font-size:10px;color:var(--muted-foreground);display:flex;gap:5px;align-items:center}.snapshot i{height:6px;width:6px;border-radius:50%;background:#6d9c7a}.snapshot i.demo{background:#bd954f}.tools{margin-left:auto;display:flex;gap:6px;align-items:center}button,.baseline,select{border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--foreground);background:var(--card);font-size:11px;cursor:pointer;text-decoration:none}button:hover,.baseline:hover{background:var(--accent)}button:disabled{opacity:.4;cursor:default}.filter-bar{display:flex;gap:7px;align-items:center;flex-shrink:0;border-bottom:1px solid var(--border);padding-bottom:8px;flex-wrap:wrap}.filter-bar input{flex:1;min-width:150px;max-width:330px;border:1px solid var(--border);border-radius:6px;padding:7px 10px;background:var(--card);font-size:11px;color:var(--foreground)}.filter-bar select{max-width:150px}.match-count{font-size:10px;color:var(--muted-foreground);margin-left:auto}.set-button{display:flex;gap:8px;align-items:center}.set-button b{background:var(--accent);border-radius:12px;padding:1px 5px;font-size:10px}.eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted-foreground);font-weight:650}.notice{font-size:11px;color:var(--muted-foreground);margin:0;flex-shrink:0}.experiment-space{min-height:0;flex:1;display:flex;position:relative}.variants{flex:1;min-width:0;min-height:0}.variant{height:100%;min-height:0;overflow:auto}.variant[hidden]{display:none}.reader{position:absolute;inset:0 0 0 auto;width:min(390px,100%);overflow:auto;border:1px solid var(--border);border-radius:10px;background:var(--card);padding:18px;z-index:35;box-shadow:-8px 0 35px #0003}
.reader-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.reader-heading button{border:0;padding:3px 7px}.reader h2{font-size:21px;line-height:1.25;letter-spacing:-.03em;margin:0 0 10px}.source-path{font-size:10px;color:var(--muted-foreground);overflow-wrap:anywhere;margin-bottom:12px}.primary{background:var(--foreground);color:var(--background);border:0}.source-body{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.75 system-ui;margin:20px 0}.set-title{width:100%;background:transparent;color:var(--foreground);border:0;font-size:21px;font-weight:600;padding:0;outline-offset:6px}.set-help{color:var(--muted-foreground);font-size:12px;line-height:1.6;margin:9px 0 14px}.set-actions{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px}.set-actions button{font-size:11px}.collected{padding:14px 0;border-bottom:1px solid var(--border)}.collected>div{display:flex;justify-content:space-between;gap:8px}.note-title{padding:0;border:0;text-align:left;font-weight:600;background:transparent}.collected p{font-size:12px;color:var(--muted-foreground);line-height:1.6;margin:9px 0}.collected small{font-size:10px;color:var(--muted-foreground)}.empty{padding:30px 6px;color:var(--muted-foreground);line-height:1.8}.export{margin-top:15px;width:100%;min-height:160px;font:11px/1.5 monospace;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:8px;padding:10px}.switcher{position:fixed;bottom:17px;left:50%;transform:translateX(-50%);display:flex;gap:3px;align-items:center;border:1px solid #425b56;background:#1c2926;padding:6px;border-radius:14px;box-shadow:0 7px 24px #0004;z-index:60;white-space:nowrap}.switcher button{border:0;color:#b7c6c2;background:transparent;padding:9px 12px;display:flex;gap:7px;align-items:center;border-radius:9px}.switcher button.active{color:#142b24;background:#c6e3d4}.switcher button:hover{background:#3b5048;color:#eef6f2}.switcher button.active:hover{background:#c6e3d4;color:#142b24}.switcher b{font-size:10px;opacity:.6}.switcher .arrow{font-size:19px;padding:4px 9px}.loading{padding:70px;color:var(--muted-foreground);text-align:center}.production-message{padding:30px}
  @media(max-width:800px){.atlas-lab{padding:0 0 60px}.lab-header{gap:6px 12px}.tools{gap:4px}.tools button,.baseline{font-size:10px;padding:5px}.snapshot{order:3;flex-basis:100%}.filter-bar{gap:5px}.filter-bar input{max-width:none}.filter-bar select{max-width:125px}.match-count{font-size:9px}.switcher{bottom:10px;padding:4px;max-width:98vw}.switcher button{padding:9px;gap:4px;font-size:11px}.switcher button span{display:none}.switcher button.active span{display:inline}.switcher .arrow{padding:4px 6px}}
</style>
