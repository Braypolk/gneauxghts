<script lang="ts">
  // C: full-vault radial edge bundling; angular grouping is categorisation, not semantic distance.
  import type { AtlasLink, AtlasNode } from '$lib/types/atlas';
  import { matchesQuery, type PrototypeProps } from './types';
  let { response, selectedIds, query, onToggle, onAddMany, onPreview }: PrototypeProps = $props();
  let kind = $state<'both' | 'wikilink' | 'semantic'>('both');
  let threshold = $state(0);
  let crossOnly = $state(true);
  let allConnections = $state(false);
  let hoveredId = $state<string | null>(null);
  let hoveredTopic = $state<string | null>(null);
  let activeTopic = $state<string | null>(null);
  let inspectedId = $state<string | null>(null);
  let graphicHeight = $state(600);
  const palette = ['#5bafa7', '#a695d0', '#ccac70', '#7b9dc5', '#cb8e99', '#a8b576', '#b18caf', '#79afb9'];
  const point = (angle: number, radius: number) => ({ x: 850 + Math.cos(angle) * radius, y: 500 + Math.sin(angle) * radius });
  let model = $derived.by(() => {
    const roots = response.clouds.filter((cloud) => !cloud.parentId);
    const buckets = roots.map((cloud, index) => ({ id: cloud.id, label: cloud.label || 'Unlabelled topic', color: cloud.color?.length >= 3 ? `rgb(${cloud.color.slice(0,3).join(',')})` : palette[index % palette.length], nodes: [] as AtlasNode[] }));
    const ungrouped = { id: '__ungrouped__', label: 'Ungrouped', color: '#9b9fa8', nodes: [] as AtlasNode[] };
    for (const node of response.nodes) {
      const rootIndex = roots.findIndex((cloud) => cloud.memberNodeIds.includes(node.id) || [node.cloudId, node.parentCloudId].includes(cloud.id));
      (buckets[rootIndex] ?? ungrouped).nodes.push(node);
    }
    if (ungrouped.nodes.length) buckets.push(ungrouped);
    const populated = buckets.filter((bucket) => bucket.nodes.length);
    const total = response.nodes.length;
    const gap = Math.min(0.065, 0.5 / Math.max(1, populated.length));
    const usable = Math.PI * 2 - gap * populated.length;
    let angle = -Math.PI / 2;
    const groups = populated.map((bucket) => {
      const start = angle + gap / 2;
      const span = usable * bucket.nodes.length / Math.max(1, total);
      const end = start + span;
      const midpoint = (start + end) / 2;
      const marks = bucket.nodes.map((node, i) => {
        const theta = start + span * (i + 0.5) / bucket.nodes.length;
        return { node, groupId: bucket.id, color: bucket.color, angle: theta, ...point(theta, 420) };
      });
      angle += span + gap;
      return { ...bucket, start, end, midpoint, marks, anchor: point(midpoint, 200), labelPoint: point(midpoint, 445) };
    });
    return { groups, marks: groups.flatMap((group) => group.marks) };
  });
  let callouts = $derived.by(() => {
    const positioned = new Map<string, { y: number; left: boolean }>();
    for (const left of [true, false]) {
      const groups = model.groups.filter((group) => (Math.cos(group.midpoint) < 0) === left).sort((a, b) => a.labelPoint.y - b.labelPoint.y);
      const gap = Math.min(94, 840 / Math.max(1, groups.length - 1));
      const ys = groups.map((group) => Math.max(70, Math.min(910, group.labelPoint.y)));
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
      if (ys.length && ys.at(-1)! > 910) {
        ys[ys.length - 1] = 910;
        for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - gap);
      }
      groups.forEach((group, i) => positioned.set(group.id, { y: ys[i], left }));
    }
    return positioned;
  });
  let marksById = $derived(new Map(model.marks.map((mark) => [mark.node.id, mark])));
  let groupsById = $derived(new Map(model.groups.map((group) => [group.id, group])));
  let eligible = $derived(response.links.filter((link) => {
    const a = marksById.get(link.sourceId), b = marksById.get(link.targetId);
    return a && b && a.node.id !== b.node.id && (kind === 'both' || link.kind === kind)
      && link.strength >= Number(threshold) && (!crossOnly || a.groupId !== b.groupId);
  }));
  let cappedIds = $derived.by(() => {
    const selected = new Set<string>();
    const incident = new Map<string, AtlasLink[]>();
    for (const link of eligible) {
      for (const id of [link.sourceId, link.targetId]) incident.set(id, [...(incident.get(id) ?? []), link]);
    }
    for (const links of incident.values()) {
      links.sort((a, b) => b.strength - a.strength).slice(0, 2).forEach((link) => selected.add(link.id));
    }
    return selected;
  });
  let focusTopic = $derived(hoveredTopic ?? activeTopic);
  let focusedNode = $derived(response.nodes.find((node) => node.id === (hoveredId ?? inspectedId)));
  let incidentLinks = $derived(focusedNode ? eligible.filter((link) => link.sourceId === focusedNode.id || link.targetId === focusedNode.id).sort((a, b) => b.strength - a.strength) : []);
  let emphasisNode = $derived(hoveredId ?? (hoveredTopic ? null : inspectedId));
  let matchingIds = $derived(new Set(response.nodes.filter(node => matchesQuery(node, query)).map(node => node.id)));
  let hasEmphasis = $derived(!!(emphasisNode || focusTopic || selectedIds.length || query));
  let highlightedLinks = $derived(new Set(eligible.filter((link) => emphasisNode
    ? link.sourceId === emphasisNode || link.targetId === emphasisNode
    : focusTopic ? (marksById.get(link.sourceId)?.groupId === focusTopic || marksById.get(link.targetId)?.groupId === focusTopic)
    : query ? matchingIds.has(link.sourceId) || matchingIds.has(link.targetId) : selectedIds.includes(link.sourceId) || selectedIds.includes(link.targetId)).map((link) => link.id)));
  let displayedLinks = $derived(eligible.filter((link) => allConnections || cappedIds.has(link.id) || highlightedLinks.has(link.id)));
  let relatedTopics = $derived(new Set(eligible.filter((link) => focusTopic && (marksById.get(link.sourceId)?.groupId === focusTopic || marksById.get(link.targetId)?.groupId === focusTopic))
    .flatMap((link) => [marksById.get(link.sourceId)!.groupId, marksById.get(link.targetId)!.groupId])));
  let activeGroup = $derived(groupsById.get(activeTopic ?? ''));
  let linkedNoteIds = $derived(new Set(incidentLinks.flatMap((link) => [link.sourceId, link.targetId])));
  let matches = $derived(response.nodes.filter((node) => matchesQuery(node, query)).length);

  function curve(link: AtlasLink) {
    const a = marksById.get(link.sourceId)!, b = marksById.get(link.targetId)!;
    const ga = groupsById.get(a.groupId)!, gb = groupsById.get(b.groupId)!;
    if (a.groupId === b.groupId) return `M ${a.x} ${a.y} Q ${ga.anchor.x} ${ga.anchor.y} ${b.x} ${b.y}`;
    const ra = point(a.angle, 345), rb = point(b.angle, 345);
    return `M ${a.x} ${a.y} C ${ra.x} ${ra.y} ${ga.anchor.x} ${ga.anchor.y} ${ga.anchor.x} ${ga.anchor.y} Q 850 500 ${gb.anchor.x} ${gb.anchor.y} C ${gb.anchor.x} ${gb.anchor.y} ${rb.x} ${rb.y} ${b.x} ${b.y}`;
  }
  function arc(start: number, end: number, radius: number) {
    const a = point(start, radius), b = point(end, radius);
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${b.x} ${b.y}`;
  }
  function activateNote(node: AtlasNode) { inspectedId = node.id; onToggle(node.id); }
  function relationSummary(link: AtlasLink) {
    const other = marksById.get(link.sourceId === focusedNode?.id ? link.targetId : link.sourceId)?.node;
    return `${link.kind === 'wikilink' ? 'Explicit link' : 'Semantic match'} · ${other?.title || other?.fileName || 'Note'} · strength ${link.strength.toFixed(2)}`;
  }
</script>

<section class="weave" aria-label="Idea weave whole-vault visualization">
  <header class="heading"><div><span class="eyebrow">C / Idea weave</span><h1>See ideas connect across your vault.</h1><p>Every note on one ring. Topic arcs bundle the connections between them.</p></div><span class="total">{model.marks.length} / {response.nodes.length} notes visible</span></header>
  <div class="controls">
    <label>Connections <select bind:value={kind} aria-label="Weave connection type"><option value="both">Linked + similar</option><option value="wikilink">Explicit links</option><option value="semantic">Semantic matches</option></select></label>
    <label class="strength">Minimum strength <input type="range" min="0" max="1" step="0.05" bind:value={threshold} aria-label="Weave minimum connection strength"/><output>{Number(threshold).toFixed(2)}</output></label>
    <label class="check"><input type="checkbox" bind:checked={crossOnly}/>Between topics only</label>
    <label class="check"><input type="checkbox" bind:checked={allConnections}/>All connections</label>
    <span class="coverage">{displayedLinks.length} / {eligible.length} eligible connections</span>
  </div>
  <div class="visual" bind:clientHeight={graphicHeight}>
    <svg viewBox="0 0 1700 1000" role="img" aria-label={`All ${model.marks.length} notes arranged by topic with ${displayedLinks.length} connections`}>
      <title>Idea weave: topic-grouped notes and actual note connections</title>
      <circle cx="850" cy="500" r="420" fill="none" stroke="currentColor" opacity="0.06"/>
      <g class="edges">
        {#each displayedLinks as link (link.id)}
          <path d={curve(link)} fill="none" stroke={link.kind === 'wikilink' ? 'var(--color-foreground)' : marksById.get(link.sourceId)!.color}
            stroke-width={highlightedLinks.has(link.id) ? 2.1 : link.kind === 'wikilink' ? 1.05 : 0.8}
            stroke-dasharray={link.kind === 'wikilink' ? 'none' : '3 2'}
            opacity={hasEmphasis ? highlightedLinks.has(link.id) ? 0.82 : 0.025 : link.kind === 'wikilink' ? 0.18 : 0.1}/>
        {/each}
      </g>
      {#each model.groups as group (group.id)}
        {@const callout = callouts.get(group.id)!}
        <g role="button" tabindex="0" aria-label={`${group.label}, ${group.nodes.length} notes. Inspect topic`}
          onmouseenter={() => hoveredTopic = group.id} onmouseleave={() => hoveredTopic = null}
          onfocus={() => hoveredTopic = group.id} onblur={() => hoveredTopic = null}
          onclick={() => { activeTopic = activeTopic === group.id ? null : group.id; inspectedId = null; }}
          onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activeTopic = activeTopic === group.id ? null : group.id; inspectedId = null; } }}>
          <path d={arc(group.start, group.end, 445)} fill="none" stroke={group.color} stroke-width={focusTopic === group.id ? 13 : relatedTopics.has(group.id) ? 9 : 6} opacity={focusTopic && !relatedTopics.has(group.id) && group.id !== focusTopic ? 0.25 : 0.85}/>
          <path d={arc(group.start, group.end, 445)} fill="none" stroke="transparent" stroke-width="35"/>
          <path d={`M ${group.labelPoint.x} ${group.labelPoint.y} L ${callout.left ? 405 : 1295} ${callout.y} L ${callout.left ? 390 : 1310} ${callout.y}`} fill="none" stroke={group.color} stroke-width="2" opacity="0.5"/>
          <text x={callout.left ? 30 : 1670} y={callout.y - 8} text-anchor={callout.left ? 'start' : 'end'} fill="currentColor" font-size="32" font-weight="550"><title>{group.label}</title>{group.label.length > 22 ? `${group.label.slice(0, 20)}…` : group.label}</text>
          <text x={callout.left ? 30 : 1670} y={callout.y + 28} text-anchor={callout.left ? 'start' : 'end'} fill={group.color} font-size="27">{group.nodes.length} notes</text>
        </g>
      {/each}
      {#each model.marks as mark (mark.node.id)}
        {@const collected = selectedIds.includes(mark.node.id)}
        {@const match = matchesQuery(mark.node, query)}
        <g role="button" tabindex="0" data-node-id={mark.node.id} aria-label={`${mark.node.title || mark.node.fileName}${collected ? ', collected' : ''}. Toggle collection`}
          onmouseenter={() => hoveredId = mark.node.id} onmouseleave={() => hoveredId = null}
          onfocus={() => hoveredId = mark.node.id} onblur={() => hoveredId = null}
          onclick={() => activateNote(mark.node)}
          onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateNote(mark.node); } }}
          opacity={!match ? 0.16 : emphasisNode && mark.node.id !== emphasisNode && !linkedNoteIds.has(mark.node.id) && !collected ? 0.3 : 1}>
          <title>{mark.node.title || mark.node.fileName}</title>
          {#if collected}<circle cx={mark.x} cy={mark.y} r="8.5" fill="none" stroke="var(--color-foreground)" stroke-width="1.4"/>{/if}
          <circle cx={mark.x} cy={mark.y} r={hoveredId === mark.node.id ? 6.5 : collected ? 4.8 : 3.7} fill={collected ? 'var(--color-foreground)' : mark.color}/>
          <circle cx={mark.x} cy={mark.y} r="9" fill="transparent"/>
        </g>
      {/each}
      {#if !model.marks.length}<text x="850" y="500" text-anchor="middle" fill="currentColor">No notes in this snapshot</text>{/if}
    </svg>
    {#if model.marks.length}
      <div class="center"><strong>{model.marks.length}</strong><span>notes · {model.groups.length} topics</span><small>Hover to trace · click to collect</small></div>
      {#if focusedNode || activeGroup}
        <div class="inspect-panel" style:max-height={`${Math.max(170, graphicHeight - 30)}px`}>
          {#if focusedNode}
            <span class="eyebrow">{hoveredId ? 'Under the pointer' : 'Focused note'}</span><h2>{focusedNode.title || focusedNode.fileName}</h2>
            <p class="excerpt">{focusedNode.preview || 'No source excerpt available.'}</p>
            <p class="node-count">{incidentLinks.length} eligible connections · {selectedIds.includes(focusedNode.id) ? 'Collected' : 'Click mark to collect'}</p>
            <div class="relationship-detail">{#each incidentLinks.slice(0, 2) as link}<span title={relationSummary(link)}>{relationSummary(link)}</span>{/each}{#if incidentLinks.length > 2}<span>+ {incidentLinks.length - 2} more highlighted</span>{/if}</div>
            <div class="center-actions"><button onclick={() => onPreview(focusedNode!)}>Read source</button><button onclick={() => { inspectedId = null; }}>Clear focus</button></div>
          {:else if activeGroup}
            <span class="eyebrow">Topic sector</span><h2>{activeGroup.label}</h2><p>{activeGroup.nodes.length} notes. Highlighted lines show this sector's actual eligible connections.</p>
            <div class="center-actions"><button onclick={() => onAddMany(activeGroup!.nodes.map((node) => node.id))}>Collect {activeGroup.nodes.length} notes</button><button onclick={() => activeTopic = null}>Clear topic</button></div>
          {/if}
        </div>
      {/if}
    {/if}
    <div class="graph-key"><span><i class="solid"></i>Explicit link</span><span><i class="dashed"></i>Semantic match</span><span><b>◉</b>Collected note</span></div>
  </div>
  <footer><span>Placement shows topic membership; angles and distance do not encode similarity.</span><span>{query.trim() ? `${matches} search matches; all notes remain visible.` : allConnections ? 'Showing every eligible connection.' : 'Top 2 strongest links per note; hover reveals additional eligible links.'}</span></footer>
</section>

<style>
  .weave { height:100%; min-height:0; display:flex; flex-direction:column; color:var(--color-foreground); }
  .heading { padding:7px 12px 8px; display:flex; align-items:center; justify-content:space-between; gap:15px; }
  .eyebrow { font-size:10px; text-transform:uppercase; letter-spacing:.13em; font-weight:650; color:var(--color-muted-foreground); }
  h1 { font-size:17px; letter-spacing:-.025em; font-weight:620; margin:0 0 3px; } .heading p { font-size:10px; color:var(--color-muted-foreground); margin:0; } .total { font-size:11px; white-space:nowrap; border:1px solid var(--color-border); border-radius:20px; padding:7px 11px; }
  .controls { display:flex; flex-wrap:wrap; align-items:center; gap:15px; padding:6px 12px; border-top:1px solid var(--color-border); border-bottom:1px solid var(--color-border); font-size:10px; color:var(--color-muted-foreground); }
  .controls label { display:flex; align-items:center; gap:7px; } select { background:var(--color-background); color:var(--color-foreground); padding:5px 6px; border:1px solid var(--color-border); border-radius:5px; font-size:10px; } .strength input { width:85px; accent-color:#5bafa7; } output { width:25px; } .check { cursor:pointer; } .check input { accent-color:#5bafa7; } .coverage { margin-left:auto; }
  .visual { position:relative; flex:1; min-height:280px; overflow:hidden; display:flex; align-items:center; justify-content:center; background:radial-gradient(circle at center,color-mix(in srgb,var(--color-muted) 30%,transparent),transparent 68%); }
  svg { width:100%; height:100%; max-height:100%; overflow:visible; } svg g[role='button'] { cursor:pointer; outline:none; } svg g[role='button']:focus-visible circle { stroke:var(--color-foreground); stroke-width:2px; } svg g[role='button']:focus-visible path { stroke-width:12px; } .edges { pointer-events:none; }
  .center { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); text-align:center; pointer-events:none; background:color-mix(in srgb,var(--color-background) 80%,transparent); padding:4px 9px; border-radius:8px; }
  .center strong { display:block; font-size:22px; line-height:1.1; font-weight:550; letter-spacing:-.035em; } .center span { display:block; font-size:9px; color:var(--color-muted-foreground); margin-top:3px; } .center small { display:block; font-size:8px; color:var(--color-muted-foreground); margin-top:6px; }
  .inspect-panel { position:absolute; right:12px; top:12px; width:220px; padding:13px; border:1px solid var(--color-border); background:color-mix(in srgb,var(--color-background) 97%,transparent); border-radius:10px; overflow:auto; box-shadow:0 6px 20px #00000010; }
  .inspect-panel h2 { font-size:14px; font-weight:600; line-height:1.4; margin:6px 0 9px; overflow-wrap:anywhere; } .inspect-panel p { font-size:10px; line-height:1.7; color:var(--color-muted-foreground); margin:7px 0; } .inspect-panel .excerpt { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; line-clamp:3; overflow:hidden; } .inspect-panel .node-count { font-size:9px; }
  .relationship-detail { display:grid; gap:4px; font-size:8px; color:var(--color-muted-foreground); line-height:1.5; } .relationship-detail span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .center-actions { display:flex; flex-wrap:wrap; gap:5px; margin-top:10px; } .center-actions button { border:1px solid var(--color-border); background:var(--color-background); border-radius:5px; padding:5px 8px; font-size:9px; cursor:pointer; } .center-actions button:hover { background:var(--color-muted); } button:focus-visible { outline:2px solid var(--color-ring); outline-offset:2px; }
  .graph-key { position:absolute; bottom:9px; left:20px; display:flex; flex-wrap:wrap; align-items:center; gap:13px; font-size:9px; color:var(--color-muted-foreground); pointer-events:none; } .graph-key span { display:flex; gap:5px; align-items:center; } .graph-key i { display:inline-block; width:18px; border-top:1px solid currentColor; } .graph-key .dashed { border-top-style:dashed; } .graph-key b { font-weight:400; font-size:12px; }
  footer { display:flex; justify-content:space-between; flex-wrap:wrap; gap:5px 15px; padding:5px 12px; font-size:9px; color:var(--color-muted-foreground); }
  @media(max-width:800px) { .heading { padding:10px; } h1 { font-size:15px; } .controls { padding:6px 10px; gap:9px; } .coverage { margin-left:0; } .total { font-size:9px; } .inspect-panel { right:7px; top:auto; bottom:30px; width:180px; padding:9px; } .inspect-panel .excerpt,.relationship-detail { display:none; } footer { padding:6px 10px; } }
  @media(max-width:560px) { .heading p,.total { display:none; } .inspect-panel { width:150px; } .inspect-panel h2 { font-size:11px; } .center { padding:3px; } .center small { display:none; } .graph-key { left:10px; font-size:8px; gap:7px; } }
  .heading .eyebrow{display:none}
</style>
