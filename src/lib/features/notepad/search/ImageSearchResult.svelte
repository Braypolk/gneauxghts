<script lang="ts">
  import type { ImageSearchItem } from '$lib/types/semantic';
  let { item, load, onSelect, active = false, onPointerEnter }: { item: ImageSearchItem; load: (item: ImageSearchItem) => Promise<string>; onSelect: () => void; active?: boolean; onPointerEnter?: () => void } = $props();
  let thumbnail = $state<string | null>(null);
  $effect(() => {
    let alive = true;
    thumbnail = null;
    void load(item).then(url => { if (alive) thumbnail = url; }).catch(() => {});
    return () => { alive = false; };
  });
</script>

<button type="button" class="image-search-result" class:bg-accent={active} data-search-result-active={active ? "true" : "false"} onmousedown={(event) => event.preventDefault()} onpointerenter={onPointerEnter} onclick={onSelect} aria-label={`Open ${item.assetName} in ${item.noteTitle}`}>
  {#if thumbnail}<img src={thumbnail} alt="" loading="lazy" />{:else}<span class="image-search-placeholder" aria-hidden="true">Image</span>{/if}
  <span><strong>{item.noteTitle}</strong><small>{item.assetName}</small></span>
</button>

<style>
  .image-search-result { display:flex; gap:12px; width:100%; text-align:left; padding:10px; border-radius:8px; }
  .image-search-result:hover { background:var(--accent); }
  .image-search-result img, .image-search-placeholder { width:60px; height:48px; object-fit:contain; flex-shrink:0; background:var(--muted); border-radius:4px; }
  .image-search-result strong { display:block; font-size:13px; font-weight:500; }
  .image-search-result small { display:block; font-size:11px; color:var(--muted-foreground); overflow-wrap:anywhere; }
</style>
