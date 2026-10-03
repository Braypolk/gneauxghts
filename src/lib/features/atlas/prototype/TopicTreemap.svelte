<script lang="ts">
  import type { AtlasNode } from '$lib/types/atlas';
  import { type PrototypeProps, topTopics, topicLabel, matchesQuery } from './types';

  let { response, selectedIds, query, onToggle, onAddMany, onPreview }: PrototypeProps = $props();
  type Rect = { x: number; y: number; w: number; h: number };
  type Group = { id: string; title: string; color: string; nodes: AtlasNode[]; children: Group[] };
  type Region = Rect & { group: Group; depth: number };
  type Leaf = Rect & { node: AtlasNode; groupId: string; color: string };
  let width = $state(1000);
  let height = $state(560);
  let focusId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let inspectedId = $state<string | null>(null);
  let linkMode = $state('cross');
  let minStrength = $state(.4);

  const groups = $derived.by(() => {
    const claimed = new Set<string>();
    const result: Group[] = [];
    for (const topic of topTopics(response)) {
      const memberIds = new Set(topic.memberNodeIds);
      const nodes = response.nodes.filter((node) => memberIds.has(node.id) && !claimed.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
      nodes.forEach((node) => claimed.add(node.id));
      if (!nodes.length) continue;
      const color = `rgb(${topic.color.slice(0, 3).join(',')})`;
      const childClaimed = new Set<string>();
      const children: Group[] = [];
      for (const child of response.clouds.filter((cloud) => cloud.parentId === topic.id)) {
        const ids = new Set(child.memberNodeIds);
        const members = nodes.filter((node) => ids.has(node.id) && !childClaimed.has(node.id));
        if (!members.length) continue;
        members.forEach((node) => childClaimed.add(node.id));
        children.push({ id: child.id, title: topicLabel(child), color, nodes: members, children: [] });
      }
      const others = nodes.filter((node) => !childClaimed.has(node.id));
      if (children.length && others.length) children.push({ id: `${topic.id}:other`, title: 'Other notes in this topic', color, nodes: others, children: [] });
      result.push({ id: topic.id, title: topicLabel(topic), color, nodes, children });
    }
    const ungrouped = response.nodes.filter((node) => !claimed.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
    if (ungrouped.length) result.push({ id: 'ungrouped', title: 'Between topics', color: 'rgb(143,148,156)', nodes: ungrouped, children: [] });
    return result;
  });

  // Balanced weighted binary subdivision. Every note has weight 1, independent of importance.
  function tile<T>(items: T[], weight: (item: T) => number, rect: Rect): { item: T; rect: Rect }[] {
    if (!items.length) return [];
    if (items.length === 1) return [{ item: items[0], rect }];
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let leftWeight = weight(items[0]), split = 1;
    while (split < items.length - 1 && Math.abs(total / 2 - leftWeight - weight(items[split])) < Math.abs(total / 2 - leftWeight)) leftWeight += weight(items[split++]);
    const proportion = leftWeight / total;
    const horizontal = rect.w >= rect.h;
    const a = horizontal ? { ...rect, w: rect.w * proportion } : { ...rect, h: rect.h * proportion };
    const b = horizontal ? { ...rect, x: rect.x + a.w, w: rect.w - a.w } : { ...rect, y: rect.y + a.h, h: rect.h - a.h };
    return [...tile(items.slice(0, split), weight, a), ...tile(items.slice(split), weight, b)];
  }
  const activeGroup = $derived(groups.find((group) => group.id === focusId));
  const layout = $derived.by(() => {
    const regions: Region[] = [], leaves: Leaf[] = [];
    const shown = activeGroup ? [activeGroup] : groups;
    for (const outer of tile(shown, (group) => group.nodes.length, { x: 5, y: 5, w: Math.max(40, width - 10), h: Math.max(40, height - 10) })) {
      regions.push({ ...outer.rect, group: outer.item, depth: 0 });
      const childGroups = outer.item.children.length ? outer.item.children : [outer.item];
      // Headers are overlays: group subdivision never steals area from notes.
      for (const inner of tile(childGroups, (group) => group.nodes.length, outer.rect)) {
        if (outer.item.children.length) regions.push({ ...inner.rect, group: inner.item, depth: 1 });
        for (const leaf of tile(inner.item.nodes, () => 1, inner.rect)) leaves.push({ ...leaf.rect, node: leaf.item, groupId: outer.item.id, color: outer.item.color });
      }
    }
    return { regions, leaves };
  });
  const positions = $derived(new Map(layout.leaves.map((leaf) => [leaf.node.id, leaf])));
  const selected = $derived(new Set(selectedIds));
  const matching = $derived(new Set(response.nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id)));
  const hovered = $derived(response.nodes.find((node) => node.id === (inspectedId ?? hoveredId)));
  const linked = $derived(response.links.filter((link) => {
    if (linkMode === 'off' || !(selected.has(link.sourceId) || selected.has(link.targetId))) return false;
    if (link.kind !== 'wikilink' && link.strength < minStrength) return false;
    const a = positions.get(link.sourceId), b = positions.get(link.targetId);
    return a && b && (linkMode === 'all' || a.groupId !== b.groupId);
  }));
  function linkPath(sourceId: string, targetId: string): string {
    const a = positions.get(sourceId)!, b = positions.get(targetId)!;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    return `M ${ax} ${ay} Q ${(ax + bx) / 2} ${(ay + by) / 2 - Math.min(100, Math.hypot(ax - bx, ay - by) * .18)} ${bx} ${by}`;
  }
  function truncate(title: string, availableWidth: number) { const chars = Math.floor(availableWidth / 6.1); return chars < 5 ? '' : title.length > chars ? `${title.slice(0, chars - 1)}…` : title; }
  function keyAction(event: KeyboardEvent, action: () => void) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } }
</script>

<section class="treemap">
  <header><div><span class="eyebrow">A / NESTED TREEMAP</span><h1>The whole vault, tiled by idea.</h1><p>Every rectangle is one note. Topic size follows note count; note importance never changes its area.</p></div><div class="scope"><strong>{layout.leaves.length} / {response.nodes.length}</strong><span>notes visible</span></div></header>
  <div class="toolbar">
    <div class="breadcrumbs"><button class:active={!focusId} onclick={() => focusId = null}>All vault</button>{#if activeGroup}<span>›</span><span>{activeGroup.title}</span>{/if}</div>
    <label>Links <select bind:value={linkMode} aria-label="Treemap relationship display"><option value="cross">Across topics</option><option value="all">All selected-note links</option><option value="off">Off</option></select></label>
    <label>Semantic strength <input type="range" min="0" max="1" step=".05" bind:value={minStrength} aria-label="Treemap minimum semantic strength" /><span>{Number(minStrength).toFixed(2)}</span></label>
  </div>
  <div class="mosaic" bind:clientWidth={width} bind:clientHeight={height}>
    <svg viewBox={`0 0 ${Math.max(width, 50)} ${Math.max(height, 50)}`} role="group" aria-label={`Whole-vault treemap, ${layout.leaves.length} notes visible`}>
      {#each layout.leaves as leaf (leaf.node.id)}
        <g class="leaf" class:chosen={selected.has(leaf.node.id)} class:dimmed={!matching.has(leaf.node.id)} role="button" tabindex="0" aria-label={`${leaf.node.title}${selected.has(leaf.node.id) ? ', selected' : ''}`} data-node-id={leaf.node.id} onclick={() => { inspectedId = leaf.node.id; hoveredId = leaf.node.id; onToggle(leaf.node.id); }} ondblclick={() => onPreview(leaf.node)} onpointerenter={() => hoveredId = leaf.node.id} onfocus={() => hoveredId = leaf.node.id} onkeydown={(event) => keyAction(event, () => onToggle(leaf.node.id))}>
          <title>{leaf.node.title} — click to select; double-click to preview</title>
          <rect x={leaf.x + .7} y={leaf.y + .7} width={Math.max(.1, leaf.w - 1.4)} height={Math.max(.1, leaf.h - 1.4)} style={`--topic: ${leaf.color}`} />
          {#if leaf.h > 24 && leaf.w > 38}<text x={leaf.x + 7} y={leaf.y + Math.min(leaf.h - 5, 27)}>{truncate(leaf.node.title, leaf.w - 14)}</text>{/if}
          {#if selected.has(leaf.node.id) && leaf.w > 24 && leaf.h > 20}<text class="check" x={leaf.x + leaf.w - 16} y={leaf.y + leaf.h - 8}>✓</text>{/if}
        </g>
      {/each}
      <g class="relationships" pointer-events="none">
        {#each linked as link (link.id)}<path d={linkPath(link.sourceId, link.targetId)} class:explicit={link.kind === 'wikilink'} />{/each}
      </g>
      {#each layout.regions as region (`${region.group.id}:${region.depth}`)}
        <rect class="boundary" x={region.x + 1.5} y={region.y + 1.5} width={Math.max(0, region.w - 3)} height={Math.max(0, region.h - 3)} stroke-width={region.depth ? 1 : 3} stroke-dasharray={region.depth ? '3 3' : undefined} pointer-events="none" />
        {#if region.depth === 0 && region.w > 70 && region.h > 25}
          <g class="region-label" role="button" tabindex="0" aria-label={`Select topic ${region.group.title}, ${region.group.nodes.length} notes`} onclick={() => onAddMany(region.group.nodes.filter((node) => matching.has(node.id)).map((node) => node.id))} onkeydown={(event) => keyAction(event, () => onAddMany(region.group.nodes.filter((node) => matching.has(node.id)).map((node) => node.id)))}>
            <title>{region.group.title} — select matching notes in this topic</title><rect x={region.x + 5} y={region.y + 5} width={Math.min(region.w - 10, region.group.title.length * 6.6 + 45)} height="21" rx="3" /><text x={region.x + 11} y={region.y + 19}>{truncate(region.group.title, region.w - 46)} · {region.group.nodes.length}</text>
          </g>
        {:else if region.depth && region.w > 95 && region.h > 58}
          <text class="child-label" x={region.x + 8} y={region.y + region.h - 7} pointer-events="none">{truncate(region.group.title, region.w - 16)}</text>
        {/if}
      {/each}
    </svg>
    {#if !response.nodes.length}<div class="empty">This Atlas snapshot has no notes.</div>{/if}
  </div>
  <div class="inspector" aria-live="polite">
    {#if hovered}<div class="hover-text"><strong>{hovered.title}</strong><p>{hovered.preview || 'No excerpt available.'}</p></div><button onclick={() => onPreview(hovered)}>Read note</button><button onclick={() => onToggle(hovered.id)}>{selected.has(hovered.id) ? 'Deselect' : 'Select'}</button>{:else}<div class="hover-text"><strong>Hover a tile to see its note.</strong><p>Click a tile to select. Topic labels select their matching notes. Filters dim tiles without moving them.</p></div>{/if}
    {#if inspectedId}<button onclick={() => {inspectedId=null;hoveredId=null;}}>Clear focus</button>{/if}
    {#if hovered}{@const group = groups.find((item) => item.nodes.some((node) => node.id === hovered.id))}{#if group && !focusId}<button onclick={() => focusId = group.id}>Zoom topic</button>{/if}{/if}
  </div>
  <footer><span>Solid boundaries: topics · dashed: subtopics · every note appears once</span><span>{query ? `${matching.size} matches remain in place · ` : ''}{linked.length} links shown · solid = wikilink, dashed = semantic</span></footer>
</section>

<style>
  .treemap { display: flex; flex-direction: column; min-height: 0; height: 100%; color: var(--foreground); background: var(--background); }
  header { padding: 7px 12px 8px; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
  .eyebrow { color: var(--muted-foreground); font-size: 10px; letter-spacing: .15em; font-weight: 600; }
  h1 { font-size: 17px; margin: 0 0 3px; font-weight: 550; letter-spacing: -.035em; }
  header .eyebrow { display:none; }
  header p { margin: 0; font-size: 10px; color: var(--muted-foreground); }
  .scope { display: flex; flex-direction: column; align-items: end; flex-shrink: 0; gap: 2px; font-size: 10px; color: var(--muted-foreground); }
  .scope strong { font-size: 17px; color: var(--foreground); font-variant-numeric: tabular-nums; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 6px 12px; border-block: 1px solid var(--border); font-size: 11px; }
  .breadcrumbs { display: flex; align-items: center; gap: 8px; margin-right: auto; }
  button, select { font: inherit; cursor: pointer; color: var(--foreground); background: var(--card); border: 1px solid var(--border); padding: 6px 9px; border-radius: 5px; }
  button:hover { background: var(--secondary); }
  button.active { color: var(--primary-foreground); background: var(--primary); }
  .toolbar label { display: flex; gap: 7px; align-items: center; color: var(--muted-foreground); }
  .toolbar input { width: 78px; accent-color: var(--primary); }
  .mosaic { flex: 1; min-height: 180px; min-width: 0; position: relative; overflow: hidden; padding: 0; }
  svg { width: 100%; height: 100%; display: block; }
  .leaf { cursor: pointer; transition: opacity .16s; }
  .leaf rect { fill: color-mix(in srgb, var(--topic) 28%, var(--background)); stroke: color-mix(in srgb, var(--topic) 50%, var(--background)); stroke-width: .8; }
  .leaf text { fill: var(--foreground); font-family: var(--font-sans); font-size: 10px; pointer-events: none; }
  .leaf:hover rect, .leaf:focus-visible rect { fill: color-mix(in srgb, var(--topic) 48%, var(--background)); stroke: var(--foreground); stroke-width: 2; }
  .leaf.dimmed { opacity: .12; }
  .leaf.chosen rect { fill: color-mix(in srgb, var(--topic) 58%, var(--background)); stroke: var(--foreground); stroke-width: 2.5; }
  .leaf.chosen.dimmed { opacity: .45; }
  .leaf .check { font-weight: 700; font-size: 13px; }
  .boundary { fill: none; stroke: var(--background); }
  .region-label { cursor: pointer; }
  .region-label rect { fill: var(--background); fill-opacity: .92; }
  .region-label text { fill: var(--foreground); font-size: 10px; font-weight: 650; pointer-events: none; }
  .region-label:hover rect { fill: var(--primary); }
  .region-label:hover text { fill: var(--primary-foreground); }
  .child-label { fill: var(--foreground); font-size: 9px; opacity: .55; font-style: italic; }
  .relationships path { fill: none; stroke: var(--foreground); stroke-width: 1.5; stroke-dasharray: 4 4; opacity: .6; }
  .relationships path.explicit { stroke-dasharray: none; opacity: .8; }
  .inspector { display: flex; align-items: center; gap: 9px; padding: 7px 12px; border-top: 1px solid var(--border); background: var(--muted); height:72px; min-height:72px; max-height:72px; flex-shrink:0; overflow:hidden; font-size: 11px; }
  .hover-text { flex: 1; min-width: 0; }
  .hover-text strong { font-size:13px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .hover-text p { margin: 4px 0 0; line-height: 1.45; color: var(--muted-foreground); overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  .inspector button { flex-shrink: 0; }
  footer { display: flex; gap: 10px; justify-content: space-between; padding: 5px 12px; font-size: 9px; color: var(--muted-foreground); }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; color: var(--muted-foreground); }
  button:focus-visible, select:focus-visible, .leaf:focus-visible, .region-label:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  @media (max-width: 650px) { header { padding: 15px; } h1 { font-size: 20px; } header p { font-size: 10px; } .toolbar { padding: 8px 15px; gap: 8px; } .scope strong { font-size: 17px; } .inspector { flex-wrap:wrap; padding:10px 15px; height:110px; min-height:110px; max-height:110px; align-content:center; } .hover-text { flex-basis: 100%; } footer { flex-direction: column; padding: 8px 15px; } }
</style>
