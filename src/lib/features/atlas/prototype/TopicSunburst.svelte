<script lang="ts">
  import type { AtlasNode } from '$lib/types/atlas';
  import { type PrototypeProps, matchesQuery, topTopics, topicLabel } from './types';

  let { response, selectedIds, query, onToggle, onAddMany, onPreview }: PrototypeProps = $props();
  type Branch = { id: string; label: string; color: string; nodes: AtlasNode[]; children: Branch[]; parentId: string | null };
  type Sector = { branch: Branch; start: number; end: number; inner: number; outer: number; depth: number };
  type Leaf = { node: AtlasNode; start: number; end: number; color: string; branchId: string; parentId: string };
  const TAU = Math.PI * 2;
  let focusId = $state<string | null>(null);
  let branchId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let pinnedId = $state<string | null>(null);
  let showLinks = $state(false);
  let linkKind = $state('all');
  let minStrength = $state(.7);

  const roots = $derived.by(() => {
    const claimed = new Set<string>();
    const result: Branch[] = [];
    for (const topic of topTopics(response)) {
      const ids = new Set(topic.memberNodeIds);
      const nodes = response.nodes.filter(node => ids.has(node.id) && !claimed.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
      if (!nodes.length) continue;
      nodes.forEach(node => claimed.add(node.id));
      const color = `rgb(${topic.color.slice(0, 3).join(',')})`;
      const children: Branch[] = [], childClaimed = new Set<string>();
      for (const child of response.clouds.filter(cloud => cloud.parentId === topic.id)) {
        const childIds = new Set(child.memberNodeIds);
        const members = nodes.filter(node => childIds.has(node.id) && !childClaimed.has(node.id));
        if (!members.length) continue;
        members.forEach(node => childClaimed.add(node.id));
        children.push({ id: child.id, label: topicLabel(child), color, nodes: members, children: [], parentId: topic.id });
      }
      const rest = nodes.filter(node => !childClaimed.has(node.id));
      if (rest.length) children.push({ id: `${topic.id}:general`, label: children.length ? 'Other in topic' : 'Notes in topic', color, nodes: rest, children: [], parentId: topic.id });
      result.push({ id: topic.id, label: topicLabel(topic), color, nodes, children, parentId: null });
    }
    const ungrouped = response.nodes.filter(node => !claimed.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
    if (ungrouped.length) {
      const child: Branch = { id: 'sunburst:ungrouped:notes', label: 'Unassigned notes', color: 'rgb(138,147,161)', nodes: ungrouped, children: [], parentId: 'sunburst:ungrouped' };
      result.push({ id: 'sunburst:ungrouped', label: 'Between topics', color: child.color, nodes: ungrouped, children: [child], parentId: null });
    }
    return result;
  });
  const allBranches = $derived(roots.flatMap(root => [root, ...root.children]));
  const focusedBranch = $derived(allBranches.find(branch => branch.id === focusId));
  const activeBranch = $derived(allBranches.find(branch => branch.id === branchId));
  const selected = $derived(new Set(selectedIds));
  const matching = $derived(new Set(response.nodes.filter(node => matchesQuery(node, query)).map(node => node.id)));
  const layout = $derived.by(() => {
    const sectors: Sector[] = [], leaves: Leaf[] = [];
    const shownRoots = focusedBranch ? [focusedBranch] : roots;
    const total = shownRoots.reduce((sum, branch) => sum + branch.nodes.length, 0);
    let rootStart = -Math.PI / 2;
    for (const root of shownRoots) {
      const rootEnd = rootStart + TAU * root.nodes.length / total;
      sectors.push({ branch: root, start: rootStart, end: rootEnd, inner: 62, outer: 160, depth: 0 });
      let childStart = rootStart;
      for (const child of root.children.length ? root.children : [root]) {
        const childEnd = childStart + TAU * child.nodes.length / total;
        sectors.push({ branch: child, start: childStart, end: childEnd, inner: 162, outer: 258, depth: 1 });
        child.nodes.forEach((node, index) => leaves.push({ node, start: childStart + (childEnd - childStart) * index / child.nodes.length, end: childStart + (childEnd - childStart) * (index + 1) / child.nodes.length, color: child.color, branchId: child.id, parentId: root.id }));
        childStart = childEnd;
      }
      rootStart = rootEnd;
    }
    return { sectors, leaves };
  });
  const positions = $derived(new Map(layout.leaves.map(leaf => [leaf.node.id, leaf])));
  const inspectNode = $derived(response.nodes.find(node => node.id === (pinnedId ?? hoveredId)));
  const incidentLinks = $derived(response.links.filter(link => {
    if (!showLinks || !inspectNode || (link.sourceId !== inspectNode.id && link.targetId !== inspectNode.id)) return false;
    return positions.has(link.sourceId) && positions.has(link.targetId) && (linkKind === 'all' || link.kind === linkKind) && (link.kind === 'wikilink' || link.strength >= minStrength);
  }));
  function point(angle: number, radius: number) { return { x: 400 + Math.cos(angle) * radius, y: 400 + Math.sin(angle) * radius }; }
  function arc(start: number, end: number, inner: number, outer: number) {
    // Split a full circle into two arcs: an SVG endpoint arc cannot close 2π by itself.
    const mid = (start + end) / 2, outerA = point(start, outer), outerM = point(mid, outer), outerB = point(end, outer), innerA = point(start, inner), innerM = point(mid, inner), innerB = point(end, inner);
    return `M${outerA.x},${outerA.y} A${outer},${outer} 0 0 1 ${outerM.x},${outerM.y} A${outer},${outer} 0 0 1 ${outerB.x},${outerB.y} L${innerB.x},${innerB.y} A${inner},${inner} 0 0 0 ${innerM.x},${innerM.y} A${inner},${inner} 0 0 0 ${innerA.x},${innerA.y} Z`;
  }
  function chord(sourceId: string, targetId: string) {
    const a = positions.get(sourceId)!, b = positions.get(targetId)!;
    const start = point((a.start + a.end) / 2, 273), end = point((b.start + b.end) / 2, 273);
    return `M${start.x},${start.y} Q400,400 ${end.x},${end.y}`;
  }
  function labelPosition(sector: Sector) { const angle = (sector.start + sector.end) / 2, p = point(angle, (sector.inner + sector.outer) / 2); return { ...p, rotation: angle * 180 / Math.PI + (Math.cos(angle) < 0 ? 180 : 0) }; }
  function labelText(sector: Sector) { const limit = sector.depth ? 12 : 10; return sector.branch.label.length > limit ? `${sector.branch.label.slice(0, limit - 1)}…` : sector.branch.label; }
  function activate(event: KeyboardEvent, callback: () => void) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callback(); } }
  function inspectLeaf(leaf: Leaf) { branchId = null; pinnedId = leaf.node.id; hoveredId = leaf.node.id; onToggle(leaf.node.id); }
  function highlightBranch(branch: Branch) { branchId = branch.id; hoveredId = null; pinnedId = null; }
  function focus(branch: Branch) { focusId = branch.id; branchId = null; pinnedId = null; hoveredId = null; }
  function reset() { focusId = null; branchId = null; pinnedId = null; hoveredId = null; }
</script>

<section class="sunburst">
  <header><h1>F · Sunburst</h1><span class="coverage"><strong>{layout.leaves.length} / {response.nodes.length}</strong> notes visible</span></header>
  <div class="controls">
    <button class:active={!focusId} onclick={reset}>All vault</button>
    <label class="focus-control">Focus idea <select value={focusId ?? ''} aria-label="Focus sunburst idea" onchange={event => { const branch = allBranches.find(item => item.id === event.currentTarget.value); if (branch) focus(branch); else reset(); }}><option value="">Whole vault</option>{#each roots as root (root.id)}<optgroup label={root.label}><option value={root.id}>{root.label} ({root.nodes.length})</option>{#each root.children as child (child.id)}<option value={child.id}>↳ {child.label} ({child.nodes.length})</option>{/each}</optgroup>{/each}</select></label>
    <label class="links-control"><input type="checkbox" bind:checked={showLinks} /> Note links</label>
    {#if showLinks}<select bind:value={linkKind} aria-label="Sunburst link kind"><option value="all">All kinds</option><option value="wikilink">Wikilinks</option><option value="semantic">Semantic</option></select><label class="strength">Strength<input type="range" min="0" max="1" step=".05" bind:value={minStrength} aria-label="Sunburst semantic link strength" /><span>{Number(minStrength).toFixed(2)}</span></label>{/if}
  </div>
  <div class="chart">
    <svg viewBox="0 0 800 800" role="group" aria-label={`Sunburst of ${layout.leaves.length} notes; center to edge shows topic, subtopic, note`}>
      {#each layout.sectors as sector (`${sector.branch.id}:${sector.depth}`)}
        {@const p = labelPosition(sector)}
        <g class="branch" class:highlighted={branchId === sector.branch.id} class:dimmed={!sector.branch.nodes.some(node => matching.has(node.id))} role="button" tabindex="0" aria-label={`${sector.branch.label}, ${sector.branch.nodes.length} notes; highlight branch`} onclick={() => highlightBranch(sector.branch)} onkeydown={event => activate(event, () => highlightBranch(sector.branch))}>
          <title>{sector.branch.label} — {sector.branch.nodes.length} notes. Click to highlight; use Focus branch to zoom.</title>
          <path d={arc(sector.start, sector.end, sector.inner, sector.outer)} style={`--topic:${sector.branch.color}; --mix:${sector.depth ? '20%' : '42%'}`} />
          {#if sector.end - sector.start > (sector.depth ? .38 : .5)}<text x={p.x} y={p.y} transform={`rotate(${p.rotation} ${p.x} ${p.y})`} text-anchor="middle" dominant-baseline="middle" font-size={sector.depth ? 18 : 22}>{labelText(sector)}</text>{/if}
        </g>
      {/each}
      {#each layout.leaves as leaf (leaf.node.id)}
        <g class="leaf" class:chosen={selected.has(leaf.node.id)} class:inspected={inspectNode?.id === leaf.node.id} class:highlighted={activeBranch?.nodes.some(node => node.id === leaf.node.id)} class:dimmed={!matching.has(leaf.node.id)} role="button" tabindex="0" aria-label={`${leaf.node.title}${selected.has(leaf.node.id) ? ', selected' : ''}; click to select`} data-node-id={leaf.node.id} onclick={() => inspectLeaf(leaf)} onpointerenter={() => { if (!pinnedId) { hoveredId = leaf.node.id; branchId = null; } }} onfocus={() => { if (!pinnedId) { hoveredId = leaf.node.id; branchId = null; } }} onkeydown={event => activate(event, () => inspectLeaf(leaf))}>
          <title>{leaf.node.title} — {leaf.node.notePath}</title>
          <path d={arc(leaf.start, leaf.end, 260, 376)} style={`--topic:${leaf.color}`} />
          {#if leaf.end - leaf.start > .18}{@const p = point((leaf.start + leaf.end) / 2, 338)}<text x={p.x} y={p.y} text-anchor="middle" dominant-baseline="middle">{selected.has(leaf.node.id) ? '✓' : '·'}</text>{/if}
        </g>
      {/each}
      <g class="chords" pointer-events="none">{#each incidentLinks as link (link.id)}<path class:explicit={link.kind === 'wikilink'} d={chord(link.sourceId, link.targetId)} />{/each}</g>
      <circle class="center" cx="400" cy="400" r="59" />
      <text class="center-total" x="400" y="394" text-anchor="middle">{layout.leaves.length}</text><text class="center-label" x="400" y="419" text-anchor="middle">{focusId ? 'IN FOCUS' : 'ALL NOTES'}</text>
    </svg>
    {#if !response.nodes.length}<div class="empty">This Atlas snapshot has no notes.</div>{/if}
    <span class="ring-guide">Inner → outer<br />Topic · subtopic · note</span>
  </div>
  <div class="topic-legend" aria-label="Sunburst topics">{#each roots as root (root.id)}<button class:highlighted={branchId === root.id} onclick={() => highlightBranch(root)}><span style={`background:${root.color}`} aria-hidden="true"></span>{root.label}<small>{root.nodes.length}</small></button>{/each}</div>
  <div class="inspector" aria-live="polite">
    {#if inspectNode}<div class="details"><strong>{inspectNode.title}</strong><p>{inspectNode.preview || 'No excerpt available.'}</p><span>{pinnedId ? 'Pinned selection' : 'Hover preview'} · {inspectNode.notePath}{showLinks ? ` · ${incidentLinks.length} visible links` : ''}</span></div><div class="actions"><button onclick={() => onPreview(inspectNode)}>Read note</button><button onclick={() => { pinnedId = null; hoveredId = null; }}>Clear preview</button></div>
    {:else if activeBranch}<div class="details"><strong>{activeBranch.label}</strong><p>{activeBranch.nodes.length} notes in this highlighted branch · {activeBranch.nodes.filter(node => matching.has(node.id)).length} match the current filters.</p><span>Focus enlarges note targets; All vault restores every note.</span></div><div class="actions"><button onclick={() => focus(activeBranch)}>Focus branch</button><button onclick={() => onAddMany(activeBranch.nodes.filter(node => matching.has(node.id)).map(node => node.id))}>Select matching</button></div>
    {:else}<div class="details"><strong>Hover an outer slice to inspect a note.</strong><p>Click a note to select and pin its preview. Click an inner branch to highlight it, then focus for larger note targets.</p><span>All notes have equal angular weight; filters dim slices in place.</span></div>{/if}
  </div>
  <footer><span>{query ? `${matching.size} matching / ` : ''}{response.nodes.length} notes · each note appears once at overview</span><span>Links: solid wikilink · dashed semantic · hierarchy is a partition</span></footer>
</section>

<style>
  .sunburst { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--background); color: var(--foreground); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 7px 12px; }
  h1 { font-size: 17px; letter-spacing: -.025em; font-weight: 550; margin: 0; }
  .coverage { font-size: 10px; color: var(--muted-foreground); text-align: right; flex-shrink: 0; }
  .coverage strong { color: var(--foreground); font-size: 12px; font-variant-numeric: tabular-nums; }
  .controls { min-height: 36px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 5px 12px; border-block: 1px solid var(--border); font-size: 10px; }
  button, select { font: inherit; border: 1px solid var(--border); border-radius: 5px; padding: 6px 9px; background: var(--card); color: var(--foreground); cursor: pointer; }
  button:hover { background: var(--secondary); }
  button.active { background: var(--primary); color: var(--primary-foreground); }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .controls label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); }
  .controls .links-control { margin-left: auto; }
  .focus-control select { max-width: 174px; }
  input { accent-color: var(--primary); }
  .strength input { width: 62px; }
  .chart { flex: 1; min-height: 150px; position: relative; min-width: 0; overflow: hidden; }
  svg { display: block; height: 100%; width: 100%; }
  .branch, .leaf { cursor: pointer; transition: opacity .15s; }
  .branch path { fill: color-mix(in srgb, var(--topic) var(--mix), var(--background)); stroke: var(--background); stroke-width: 1.5; }
  .branch text { fill: var(--foreground); pointer-events: none; font-weight: 550; }
  .branch:hover path, .branch:focus-visible path, .branch.highlighted path { stroke: var(--foreground); stroke-width: 3; fill: color-mix(in srgb, var(--topic) 62%, var(--background)); }
  .leaf path { fill: color-mix(in srgb, var(--topic) 47%, var(--background)); stroke: var(--background); stroke-width: .9; }
  .leaf text { fill: var(--foreground); font-size: 18px; pointer-events: none; font-weight: 700; }
  .leaf:hover path, .leaf:focus-visible path, .leaf.inspected path { fill: color-mix(in srgb, var(--topic) 85%, var(--background)); stroke: var(--foreground); stroke-width: 2.5; }
  .leaf.chosen path { fill: color-mix(in srgb, var(--topic) 80%, var(--background)); stroke: var(--foreground); stroke-width: 2; }
  .leaf.highlighted path { fill: color-mix(in srgb, var(--topic) 70%, var(--background)); }
  .dimmed { opacity: .14; }
  .chosen.dimmed { opacity: .4; }
  .chords path { fill: none; stroke: var(--foreground); stroke-width: 1.8; stroke-dasharray: 5 5; opacity: .65; }
  .chords path.explicit { stroke-dasharray: none; opacity: .85; }
  .center { fill: var(--background); }
  .center-total { fill: var(--foreground); font-size: 27px; font-weight: 650; }
  .center-label { fill: var(--muted-foreground); font-size: 9px; letter-spacing: .11em; }
  .ring-guide { position: absolute; bottom: 8px; left: 20px; color: var(--muted-foreground); font-size: 9px; line-height: 1.7; pointer-events: none; }
  .topic-legend { display: flex; gap: 5px; overflow-x: auto; flex-shrink: 0; padding: 4px 12px; border-top: 1px solid var(--border); }
  .topic-legend button { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; font-size: 10px; padding: 4px 6px; }
  .topic-legend button.highlighted { border-color: var(--foreground); background: var(--secondary); }
  .topic-legend span { width: 7px; height: 7px; border-radius: 50%; }
  .topic-legend small { color: var(--muted-foreground); font-size: 9px; }
  .inspector { height: 80px; min-height: 80px; flex-shrink: 0; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--border); background: var(--muted); }
  .details { flex: 1; min-width: 0; }
  .details strong { display: block; font-size: 12px; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .details p { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 10px; line-height: 1.5; margin: 4px 0; color: var(--muted-foreground); }
  .details span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 9px; color: var(--muted-foreground); }
  .actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; font-size: 10px; }
  footer { padding: 5px 12px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 5px 14px; font-size: 8px; color: var(--muted-foreground); flex-shrink: 0; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted-foreground); font-size: 12px; }
  @media (max-width: 650px) { .controls .links-control { margin-left: 0; } .ring-guide { left: 12px; } }
</style>
