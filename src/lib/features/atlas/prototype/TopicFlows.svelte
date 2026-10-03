<script lang="ts">
  import type { AtlasNode, AtlasLink } from '$lib/types/atlas';
  import { matchesQuery, topTopics, topicLabel, type PrototypeProps } from './types';
  type Region = { id: string; label: string; color: string; nodes: AtlasNode[] };
  type Flow = { nodeId: string; targetId: string; count: number; weight: number; semantic: number; explicit: number; partners: Set<string> };
  let { response, selectedIds, query, onToggle, onAddMany, onPreview }: PrototypeProps = $props();
  let kind = $state<'all' | 'semantic' | 'wikilink'>('all');
  let threshold = $state(0);
  let density = $state('2');
  let order = $state<'topics' | 'connections'>('topics');
  let focusedNodeId = $state<string | null>(null);
  let focusedTopicId = $state<string | null>(null);
  let focusedSide = $state<'primary' | 'related'>('primary');
  let pinned = $state(false);
  let lens = $state(true);
  let lensAnchor = $state(0);
  let measuredWidth = $state(0);
  let measuredHeight = $state(0);
  let plotWidth = $state(1080);
  let plotHeight = $state(520);
  $effect(() => {
    // The comparison shell keeps hidden variants mounted; retain useful dimensions.
    if (measuredWidth > 0) plotWidth = measuredWidth;
    if (measuredHeight > 0) plotHeight = Math.max(140, measuredHeight - 24);
  });
  const selected = $derived(new Set(selectedIds));
  const matching = $derived(new Set(response.nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id)));
  const nodeMap = $derived(new Map(response.nodes.map((node) => [node.id, node])));
  const membership = $derived.by(() => {
    const result = new Map<string, string>();
    const top = topTopics(response);
    for (const node of response.nodes) {
      const explicit = top.find((topic) => topic.id === node.parentCloudId || topic.id === node.cloudId);
      const region = explicit ?? top.find((topic) => topic.memberNodeIds.includes(node.id));
      result.set(node.id, region?.id ?? '__ungrouped');
    }
    return result;
  });
  const regions = $derived.by(() => {
    const result: Region[] = topTopics(response).map((topic) => ({ id: topic.id, label: topicLabel(topic), color: `rgb(${topic.color.slice(0, 3).join(',')})`, nodes: response.nodes.filter((node) => membership.get(node.id) === topic.id) }));
    const ungrouped = response.nodes.filter((node) => membership.get(node.id) === '__ungrouped');
    if (ungrouped.length) result.push({ id: '__ungrouped', label: 'Ungrouped', color: 'var(--muted-foreground)', nodes: ungrouped });
    return result.filter((region) => region.nodes.length);
  });
  const regionMap = $derived(new Map(regions.map((region) => [region.id, region])));
  const crossLinks = $derived(response.links.filter((link) => nodeMap.has(link.sourceId) && nodeMap.has(link.targetId) && membership.get(link.sourceId) !== membership.get(link.targetId)));
  const eligibleLinks = $derived(crossLinks.filter((link) => (kind === 'all' || kind === link.kind) && link.strength >= threshold));
  const rawFlows = $derived(makeFlows(crossLinks));
  const flows = $derived(makeFlows(eligibleLinks));
  const regionWeights = $derived.by(() => {
    const result = new Map<string, number>();
    for (const flow of rawFlows) result.set(flow.targetId, (result.get(flow.targetId) ?? 0) + flow.weight);
    return result;
  });
  const lanes = $derived.by(() => {
    const sorted = [...regions].sort((a, b) => order === 'connections' ? (regionWeights.get(b.id) ?? 0) - (regionWeights.get(a.id) ?? 0) || a.label.localeCompare(b.label) : a.label.localeCompare(b.label));
    const total = sorted.reduce((sum, region) => sum + region.nodes.length + 4, 0);
    let top = 62;
    return sorted.map((region) => {
      const height = (region.nodes.length + 4) / Math.max(1, total) * 514;
      const lane = { ...region, top, height, y: top + height / 2, nodes: [...region.nodes].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)) };
      top += height;
      return lane;
    });
  });
  const laneMap = $derived(new Map(lanes.map((lane) => [lane.id, lane])));
  const labelPlacements = $derived.by(() => {
    const min = 44, max = Math.max(min, plotHeight - 25), gap = 14;
    const capacity = Math.max(1, Math.floor((max - min) / gap) + 1);
    const tracks = Math.max(1, Math.ceil(lanes.length / capacity));
    const result = new Map<string, { y: number; track: number; tracks: number; roomForCount: boolean }>();
    for (let track = 0; track < tracks; track++) {
      const values = lanes.filter((_, index) => index % tracks === track);
      const ys = values.map((lane, index) => Math.max(Y(lane.y), min + index * gap));
      for (let index = 1; index < ys.length; index++) ys[index] = Math.max(ys[index], ys[index - 1] + gap);
      if (ys.length) ys[ys.length - 1] = Math.min(ys[ys.length - 1], max);
      for (let index = ys.length - 2; index >= 0; index--) ys[index] = Math.min(ys[index], ys[index + 1] - gap);
      values.forEach((lane, index) => result.set(lane.id, { y: ys[index], track, tracks, roomForCount: tracks === 1 && (ys[index + 1] ?? max + 24) - ys[index] >= 24 && ys[index] - (ys[index - 1] ?? min - 24) >= 24 }));
    }
    return result;
  });
  const marks = $derived(lanes.flatMap((lane) => {
    const cols = Math.min(6, lane.nodes.length), rows = Math.ceil(lane.nodes.length / cols);
    const pitch = Math.min(17, Math.max(2, (lane.height - 12) / Math.max(1, rows)));
    return lane.nodes.map((node, index) => ({ node, laneId: lane.id, x: 477 + (index % cols) * 15, y: lane.y + (Math.floor(index / cols) - (rows - 1) / 2) * pitch, radius: Math.min(4.7, pitch * 0.36), row: index }));
  }));
  const markMap = $derived(new Map(marks.map((mark) => [mark.node.id, mark])));
  const flowMap = $derived.by(() => {
    const result = new Map<string, Flow[]>();
    for (const flow of flows) result.set(flow.nodeId, [...(result.get(flow.nodeId) ?? []), flow]);
    for (const values of result.values()) values.sort((a, b) => b.weight - a.weight || a.targetId.localeCompare(b.targetId));
    return result;
  });
  const rawFlowMap = $derived.by(() => {
    const result = new Map<string, Flow[]>();
    for (const flow of rawFlows) result.set(flow.nodeId, [...(result.get(flow.nodeId) ?? []), flow]);
    return result;
  });
  const displayedFlows = $derived(flows.filter((flow) => flow.nodeId === focusedNodeId || (focusedSide === 'related' && flow.targetId === focusedTopicId) || density === 'all' || (flowMap.get(flow.nodeId)?.indexOf(flow) ?? 0) < Number(density)));
  const focusedNode = $derived(focusedNodeId ? nodeMap.get(focusedNodeId) : null);
  const focusedTopic = $derived(focusedTopicId ? regionMap.get(focusedTopicId) : null);
  const activeIds = $derived.by(() => {
    if (focusedNodeId) return new Set([focusedNodeId]);
    if (!focusedTopicId) return null;
    return new Set(focusedSide === 'primary' ? focusedTopic?.nodes.map((node) => node.id) ?? [] : flows.filter((flow) => flow.targetId === focusedTopicId).map((flow) => flow.nodeId));
  });
  const topicMembers = $derived(response.nodes.filter((node) => activeIds?.has(node.id) && matching.has(node.id)));
  const lensMarks = $derived(marks.slice(Math.max(0, Math.min(marks.length - 18, lensAnchor - 8)), Math.max(0, Math.min(marks.length - 18, lensAnchor - 8)) + 18));
  const notesWithoutEligibleCrossLinks = $derived(response.nodes.filter((node) => !flowMap.has(node.id)));

  function makeFlows(links: AtlasLink[]): Flow[] {
    const result = new Map<string, Flow>();
    for (const link of links) for (const [nodeId, otherId] of [[link.sourceId, link.targetId], [link.targetId, link.sourceId]]) {
      const targetId = membership.get(otherId);
      if (!targetId) continue;
      const key = `${nodeId}\0${targetId}`;
      const flow = result.get(key) ?? { nodeId, targetId, count: 0, weight: 0, semantic: 0, explicit: 0, partners: new Set<string>() };
      flow.count++; flow.weight += link.strength; flow.partners.add(otherId);
      if (link.kind === 'semantic') flow.semantic++; else flow.explicit++;
      result.set(key, flow);
    }
    return [...result.values()];
  }
  function inspect(nodeId: string, moveLens = true) {
    focusedNodeId = nodeId; focusedTopicId = null;
    if (moveLens) lensAnchor = marks.findIndex((mark) => mark.node.id === nodeId);
  }
  function chooseNote(nodeId: string, moveLens = true) { inspect(nodeId, moveLens); pinned = true; }
  function chooseTopic(topicId: string, side: 'primary' | 'related') { focusedTopicId = topicId; focusedNodeId = null; focusedSide = side; pinned = true; }
  function clear() { focusedNodeId = null; focusedTopicId = null; pinned = false; }
  function flowPath(flow: Flow) {
    const mark = markMap.get(flow.nodeId), target = laneMap.get(flow.targetId);
    return mark && target ? `M ${X(mark.x + 5)} ${Y(mark.y)} C ${X(652)} ${Y(mark.y)} ${X(687)} ${Y(target.y)} ${X(805)} ${Y(target.y)}` : '';
  }
  function trace(flow: Flow) { return !activeIds || activeIds.has(flow.nodeId) || (focusedSide === 'related' && focusedTopicId === flow.targetId); }
  function keyboard(event: KeyboardEvent, action: () => void) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); action(); } }
  function X(value: number) { return value / 1080 * plotWidth; }
  function Y(value: number) { return 44 + (value - 62) / 514 * Math.max(55, plotHeight - 78); }
  function radius(value: number) { return Math.max(0.75, Math.min(value, value / 514 * Math.max(55, plotHeight - 78), value / 1080 * plotWidth)); }
  function shortLabel(label: string, side: 'primary' | 'related', tracks: number) {
    const available = side === 'primary' ? X(200) - 8 : plotWidth - X(845) - 8;
    const length = Math.max(4, Math.min(34, Math.floor(available / tracks / 5.7)));
    return label.length > length ? `${label.slice(0, length - 1)}…` : label;
  }
</script>

<section class="flows-workspace">
  <header><div><span class="eyebrow">G / topic flows</span><h1>Which ideas reach beyond their region?</h1><p>Primary membership on the left. Recorded affinity with other regions on the right.</p></div><div class="coverage"><strong>{response.nodes.length} / {response.nodes.length} notes</strong><span>{eligibleLinks.length} / {crossLinks.length} eligible cross-topic links</span></div></header>
  <div class="controls">
    <label>Links <select bind:value={kind}><option value="all">All kinds</option><option value="semantic">Semantic only</option><option value="wikilink">Explicit only</option></select></label>
    <label>Min strength <input type="range" min="0" max="1" step="0.05" bind:value={threshold} /><output>{threshold.toFixed(2)}</output></label>
    <label>Flow density <select bind:value={density}><option value="1">Strongest 1 / note</option><option value="2">Strongest 2 / note</option><option value="all">All bundles</option></select></label>
    <label>Order <select bind:value={order}><option value="topics">Topic name</option><option value="connections">Cross-link strength</option></select></label>
    <label class="check"><input type="checkbox" bind:checked={lens} />Detail lens</label>
    <span class="flow-count">{displayedFlows.length} / {flows.length} bundles · {matching.size} query matches</span>
  </div>
  <div class="body">
    <div class="graphic" bind:clientWidth={measuredWidth} bind:clientHeight={measuredHeight}>
      <svg viewBox={`0 0 ${plotWidth} ${plotHeight}`} preserveAspectRatio="none" role="img" aria-label={`All ${marks.length} note identities, grouped by their primary Atlas region. ${displayedFlows.length} bundles show recorded cross-region relationships, without implying extra membership or direction.`}>
        <text class="column-title" x={X(220)} y="15" text-anchor="middle">PRIMARY REGION</text><text class="column-title" x={X(515)} y="15" text-anchor="middle">EVERY NOTE</text><text class="column-title" x={X(805)} y="15" text-anchor="middle">LINKED REGIONS</text>
        <text class="column-subtitle" x={X(220)} y="30" text-anchor="middle">Atlas assignment</text><text class="column-subtitle" x={X(515)} y="30" text-anchor="middle">{plotWidth > 500 ? 'one marker per identity' : 'all identities'}</text><text class="column-subtitle" x={X(805)} y="30" text-anchor="middle">{plotWidth > 500 ? 'affinity, not membership' : 'affinity, not assignment'}</text>
        {#each lanes as lane (lane.id)}<rect x={X(461)} y={Y(lane.top + 3)} width={X(108)} height={Math.max(1, Y(lane.height + 62) - Y(68))} rx="4" fill={lane.color} opacity="0.055" />{/each}
        {#each marks as mark (mark.node.id)}
          {@const lane = laneMap.get(mark.laneId)!}
          <path d={`M ${X(231)} ${Y(lane.y)} C ${X(325)} ${Y(lane.y)} ${X(388)} ${Y(mark.y)} ${X(mark.x - 5)} ${Y(mark.y)}`} fill="none" stroke={lane.color} stroke-width={activeIds?.has(mark.node.id) ? 1.6 : 0.6} opacity={!matching.has(mark.node.id) ? 0.02 : activeIds ? activeIds.has(mark.node.id) ? 0.65 : 0.035 : 0.12} pointer-events="none" />
        {/each}
        {#each displayedFlows as flow (flow.nodeId + ':' + flow.targetId)}
          <path d={flowPath(flow)} fill="none" stroke={regionMap.get(flow.targetId)?.color ?? 'var(--muted-foreground)'} stroke-width={Math.min(5, 0.5 + Math.sqrt(flow.weight) * 0.4)} stroke-dasharray={flow.explicit ? undefined : '3 2'} opacity={!matching.has(flow.nodeId) ? 0.02 : trace(flow) ? activeIds ? 0.8 : 0.16 : 0.025} pointer-events="none" />
        {/each}
        {#each lanes as lane (lane.id)}
          {@const incoming = flows.filter((flow) => flow.targetId === lane.id)}
          {@const totalWeight = incoming.reduce((sum, flow) => sum + flow.weight, 0)}
          {@const label = labelPlacements.get(lane.id)!}
          {@const barHeight = Math.max(2, Math.min(10, Y(lane.height + 62) - Y(62) - 2))}
          {@const leftLabelX = X(200) - label.track * (X(200) - 8) / label.tracks}
          {@const rightLabelX = X(845) + label.track * (plotWidth - X(845) - 8) / label.tracks}
          <g role="button" tabindex="0" aria-label={`Inspect primary region ${lane.label}, ${lane.nodes.length} notes`} onclick={() => chooseTopic(lane.id, 'primary')} onkeydown={(event) => keyboard(event, () => chooseTopic(lane.id, 'primary'))}>
            <title>{lane.label}: {lane.nodes.length} primary members. Click to inspect or collect.</title><path d={`M ${X(211)} ${Y(lane.y)} L ${leftLabelX + 3} ${label.y}`} fill="none" stroke={lane.color} stroke-width="0.7" opacity="0.5" pointer-events="none" /><rect x={X(211)} y={Y(lane.y) - barHeight / 2} width={Math.max(5, X(20))} height={barHeight} rx="2" fill={lane.color} class:topic-active={focusedTopicId === lane.id && focusedSide === 'primary'} /><text class="region-label" x={leftLabelX} y={label.y + 3} text-anchor="end">{shortLabel(lane.label, 'primary', label.tracks)}</text>{#if label.roomForCount}<text class="region-count" x={leftLabelX} y={label.y + 14} text-anchor="end">{lane.nodes.length} notes</text>{/if}
          </g>
          <g role="button" tabindex="0" aria-label={`Inspect linked region ${lane.label}, ${incoming.length} linked source notes`} onclick={() => chooseTopic(lane.id, 'related')} onkeydown={(event) => keyboard(event, () => chooseTopic(lane.id, 'related'))}>
            <title>{lane.label}: {incoming.length} source notes with eligible cross-region links. Total strength {totalWeight.toFixed(2)}.</title><path d={`M ${X(833)} ${Y(lane.y)} L ${rightLabelX - 3} ${label.y}`} fill="none" stroke={lane.color} stroke-width="0.7" opacity="0.5" pointer-events="none" /><rect x={X(805)} y={Y(lane.y) - barHeight / 2} width={Math.max(3, X(Math.min(28, 3 + Math.sqrt(totalWeight) * 2)))} height={barHeight} rx="2" fill={lane.color} opacity={incoming.length ? 0.9 : 0.2} class:topic-active={focusedTopicId === lane.id && focusedSide === 'related'} /><text class="region-label" x={rightLabelX} y={label.y + 3}>{shortLabel(lane.label, 'related', label.tracks)}</text>{#if label.roomForCount}<text class="region-count" x={rightLabelX} y={label.y + 14}>{plotWidth > 700 ? `${incoming.length} source notes · Σ ${totalWeight.toFixed(1)}` : `${incoming.length} notes · Σ ${totalWeight.toFixed(1)}`}</text>{/if}
          </g>
        {/each}
        {#each marks as mark (mark.node.id)}
          {@const raw = rawFlowMap.get(mark.node.id) ?? []}
          <g role="button" tabindex="0" aria-label={`Inspect ${mark.node.title}, ${raw.length} linked regions${selected.has(mark.node.id) ? ', collected' : ''}`} onpointerenter={() => { if (!pinned) inspect(mark.node.id); }} onclick={() => chooseNote(mark.node.id)} onkeydown={(event) => keyboard(event, () => chooseNote(mark.node.id))}>
            <title>{mark.node.title} · {regionMap.get(mark.laneId)?.label ?? 'Ungrouped'} · {raw.length ? `${raw.length} linked regions` : 'No recorded cross-topic links'}</title>
            <circle cx={X(mark.x)} cy={Y(mark.y)} r={Math.max(3, radius(mark.radius))} fill="transparent" />
            <circle data-node-id={mark.node.id} cx={X(mark.x)} cy={Y(mark.y)} r={radius(mark.radius)} fill={raw.length ? regionMap.get(mark.laneId)?.color ?? 'var(--muted-foreground)' : 'var(--background)'} stroke={selected.has(mark.node.id) || focusedNodeId === mark.node.id ? 'var(--foreground)' : regionMap.get(mark.laneId)?.color ?? 'var(--muted-foreground)'} stroke-width={selected.has(mark.node.id) || focusedNodeId === mark.node.id ? 1.7 : 0.9} opacity={!matching.has(mark.node.id) ? 0.14 : activeIds && !activeIds.has(mark.node.id) ? 0.3 : 1} />
          </g>
        {/each}
        {#if focusedNode && !(flowMap.get(focusedNode.id)?.length)}{@const mark = markMap.get(focusedNode.id)!}<path d={`M ${X(mark.x + 6)} ${Y(mark.y)} C ${X(660)} ${Y(mark.y)} ${X(700)} ${plotHeight - 15} ${X(805)} ${plotHeight - 15}`} fill="none" stroke="var(--muted-foreground)" stroke-width="1" stroke-dasharray="1 4" pointer-events="none" />{/if}
        <text class="no-links" x={X(805)} y={plotHeight - 6} text-anchor="middle">{notesWithoutEligibleCrossLinks.length} without eligible cross-links</text>
        {#if !marks.length}<text x={plotWidth / 2} y={plotHeight / 2} text-anchor="middle" fill="var(--muted-foreground)">No notes in this snapshot</text>{/if}
      </svg>
      <div class="graph-key"><span><i></i>Explicit included</span><span><i class="dashed"></i>Semantic only</span><span>○ No recorded cross-topic links</span><span>Width ∝ √ summed strength</span></div>
    </div>
    <aside class="inspector">
      {#if lens && marks.length}
        <div class="lens-heading"><strong>Note detail lens</strong><span>Hover the center rail or step through notes</span><div class="lens-navigation"><button aria-label="Previous note detail group" onclick={() => lensAnchor = Math.max(0, lensAnchor - 18)}>‹</button><span>{marks.indexOf(lensMarks[0]) + 1}–{marks.indexOf(lensMarks[lensMarks.length - 1]) + 1} / {marks.length}</span><button aria-label="Next note detail group" onclick={() => lensAnchor = Math.min(marks.length - 1, lensAnchor + 18)}>›</button></div></div>
        <div class="lens-grid" aria-label="Magnified neighboring note markers">
          {#each lensMarks as mark (mark.node.id)}<button data-lens-note-id={mark.node.id} style={`--note-color:${regionMap.get(mark.laneId)?.color ?? 'var(--muted-foreground)'}`} class:focused={focusedNodeId === mark.node.id} class:collected={selected.has(mark.node.id)} class:dimmed={!matching.has(mark.node.id)} title={mark.node.title} aria-label={`Inspect ${mark.node.title}`} onpointerenter={() => { if (!pinned) inspect(mark.node.id, false); }} onfocus={() => inspect(mark.node.id, false)} onclick={() => chooseNote(mark.node.id, false)}>{marks.indexOf(mark) + 1}</button>{/each}
        </div>
      {/if}
      <div class="inspection-heading"><span>{pinned ? 'Pinned inspection' : 'Inspection'}</span>{#if focusedNode || focusedTopic}<button onclick={clear}>Clear</button>{/if}</div>
      {#if focusedNode}
        <span class="type-label">{regionMap.get(membership.get(focusedNode.id) ?? '')?.label ?? 'Ungrouped'} · primary region</span><button class="source-title" onclick={() => onPreview(focusedNode)}>{focusedNode.title} ↗</button><p class="excerpt">{focusedNode.preview || focusedNode.notePath}</p>
        <div class="note-actions"><button onclick={() => onToggle(focusedNode.id)}>{selected.has(focusedNode.id) ? 'Remove from set' : 'Collect note'}</button>{#if pinned}<button onclick={() => pinned = false}>Unpin</button>{/if}</div>
        <h2>Recorded affinity with other regions</h2>
        {#each flowMap.get(focusedNode.id) ?? [] as flow (flow.targetId)}<div class="affinity"><button onclick={() => chooseTopic(flow.targetId, 'related')}>{regionMap.get(flow.targetId)?.label ?? 'Ungrouped'}</button><span>{flow.count} links / {flow.partners.size} notes · Σ {flow.weight.toFixed(2)}</span><small>{flow.explicit} explicit · {flow.semantic} semantic</small><button class="partner-preview" onclick={() => { const partner = nodeMap.get([...flow.partners][0]); if (partner) onPreview(partner); }}>Read a linked source ↗</button></div>
        {:else}<p class="empty">{rawFlowMap.has(focusedNode.id) ? 'Its cross-topic links are hidden by the current kind or strength filters.' : 'No recorded cross-topic links. This note remains visible in its primary region.'}</p>{/each}
      {:else if focusedTopic}
        <span class="type-label">{focusedSide === 'primary' ? 'Primary membership' : 'Recorded affinity'}</span><h2 class="topic-title">{focusedTopic.label}</h2><p class="empty">{focusedSide === 'primary' ? `${focusedTopic.nodes.length} notes assigned to this Atlas region.` : `${activeIds?.size ?? 0} notes in other regions have eligible links to members here. This is a relationship, not another assignment.`}</p><button class="collect" disabled={!topicMembers.length} onclick={() => onAddMany(topicMembers.map((node) => node.id))}>Collect {topicMembers.length} matching notes</button>
      {:else}<h2>Trace an idea across regions</h2><p class="empty">Hover or click any center note. Its primary membership and actual links to other regions stand out. The detail lens keeps small markers targetable.</p><p class="empty">Click either topic rail to highlight and collect its matching source notes.</p>{/if}
      <div class="honesty">Each note has one displayed primary Atlas assignment. Right-hand bundles aggregate recorded links by source note and partner region. Their strength sums are a visual summary, not probabilities. Links are mirrored for exploration; flows imply no direction or causation.</div>
    </aside>
  </div>
</section>

<style>
  .flows-workspace { height:100%; min-height:0; display:flex; flex-direction:column; padding:7px 12px 0; color:var(--foreground); } header { display:flex; align-items:center; justify-content:space-between; gap:14px; padding-bottom:8px; }.eyebrow { display:none; } h1 { margin:0 0 3px; font-size:17px; font-weight:600; letter-spacing:-.035em; } header p { margin:0; font-size:10px; color:var(--muted-foreground); }.coverage { display:flex; flex-direction:column; gap:3px; align-items:flex-end; white-space:nowrap; }.coverage strong { font-size:13px; font-weight:600; }.coverage span { font-size:9px; color:var(--muted-foreground); }
  .controls { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:6px 0 8px; border-top:1px solid var(--border); color:var(--muted-foreground); font-size:10px; }.controls label { display:flex; align-items:center; gap:6px; } select { background:var(--background); color:var(--foreground); border:1px solid var(--border); border-radius:4px; padding:4px 6px; font-size:10px; }.controls input[type=range] { width:65px; accent-color:var(--primary); } output { min-width:24px; font-variant-numeric:tabular-nums; }.check input { accent-color:var(--primary); }.flow-count { margin-left:auto; font-size:9px; }
  .body { display:grid; grid-template-columns:minmax(0,1fr) 235px; flex:1; min-height:0; border:1px solid var(--border); border-radius:9px; overflow:hidden; }.graphic { position:relative; min-height:0; min-width:0; background:color-mix(in srgb,var(--muted) 30%,var(--background)); padding-bottom:24px; } svg { display:block; height:100%; width:100%; } svg g[role=button] { cursor:pointer; } svg g[role=button]:focus { outline:none; } svg g[role=button]:focus circle,svg g[role=button]:focus rect { stroke:var(--ring); stroke-width:2; }.column-title { fill:var(--foreground); font-size:11px; font-weight:650; letter-spacing:.11em; }.column-subtitle { fill:var(--muted-foreground); font-size:9px; }.region-label { fill:var(--foreground); font-size:12px; font-weight:550; }.region-count,.no-links { fill:var(--muted-foreground); font-size:9px; }.topic-active { stroke:var(--foreground); stroke-width:2; }.graph-key { position:absolute; bottom:8px; left:12px; right:12px; display:flex; justify-content:center; flex-wrap:wrap; gap:10px; font-size:8px; color:var(--muted-foreground); }.graph-key span { display:flex; align-items:center; gap:4px; }.graph-key i { display:inline-block; width:13px; border-top:1px solid currentColor; }.graph-key .dashed { border-top-style:dashed; }
  .inspector { min-height:0; border-left:1px solid var(--border); overflow:auto; padding:12px; background:var(--background); } button { cursor:pointer; color:inherit; font:inherit; } button:disabled { opacity:.35; cursor:default; }.lens-heading { display:flex; flex-direction:column; gap:3px; margin-bottom:8px; }.lens-heading strong { font-size:10px; font-weight:600; }.lens-heading span { font-size:8px; color:var(--muted-foreground); }.lens-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:4px; padding-bottom:12px; border-bottom:1px solid var(--border); }.lens-grid button { aspect-ratio:1; background:var(--background); border:1px solid var(--note-color); border-radius:3px; font-size:8px; position:relative; }.lens-grid button:before { content:''; position:absolute; left:4px; top:4px; width:4px; height:4px; border-radius:50%; background:var(--note-color); }.lens-grid .focused { outline:2px solid var(--foreground); outline-offset:-2px; }.lens-grid .collected { background:var(--muted); font-weight:700; }.lens-grid .dimmed { opacity:.25; }.lens-grid button:focus-visible { outline:2px solid var(--ring); }
  .inspection-heading { display:flex; justify-content:space-between; align-items:center; margin:14px 0 12px; font-size:9px; color:var(--muted-foreground); }.inspection-heading button { background:var(--background); border:1px solid var(--border); border-radius:4px; padding:3px 6px; font-size:9px; }.type-label { display:block; font-size:8px; color:var(--muted-foreground); text-transform:uppercase; letter-spacing:.04em; }.source-title { display:block; text-align:left; border:0; background:transparent; margin:6px 0; padding:0; font-size:13px; line-height:1.5; font-weight:600; }.source-title:hover { text-decoration:underline; }.excerpt { font-size:10px; line-height:1.6; color:var(--muted-foreground); display:-webkit-box; -webkit-line-clamp:3; line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; margin:8px 0; }.note-actions { display:flex; gap:5px; margin-bottom:18px; }.note-actions button { border:1px solid var(--border); background:var(--background); border-radius:4px; padding:5px 7px; font-size:9px; } h2 { font-size:11px; font-weight:600; margin:15px 0 8px; line-height:1.4; }.topic-title { font-size:16px; }.affinity { border-bottom:1px solid var(--border); padding:10px 0; display:flex; flex-direction:column; gap:5px; }.affinity>button:first-child { border:0; background:transparent; text-align:left; padding:0; font-size:11px; font-weight:550; }.affinity span { font-size:9px; color:var(--muted-foreground); }.affinity small { font-size:8px; color:var(--muted-foreground); }.partner-preview { align-self:flex-start; border:0; background:transparent; padding:0; font-size:8px; text-decoration:underline; text-underline-offset:2px; }.empty { font-size:10px; line-height:1.7; color:var(--muted-foreground); }.collect { width:100%; border:0; background:var(--primary); color:var(--primary-foreground); border-radius:5px; padding:8px; font-size:10px; }.honesty { margin-top:20px; padding-top:12px; border-top:1px solid var(--border); font-size:8px; line-height:1.6; color:var(--muted-foreground); }
  @media(max-width:950px) { .body { grid-template-columns:minmax(0,1fr) 200px; }.controls { gap:8px; }.flow-count { margin-left:0; }.inspector { padding:9px; } }
  @media(max-width:650px) { .flows-workspace { padding:6px 6px 0; }.coverage { display:none; }.body { grid-template-columns:minmax(0,1fr) 155px; }.lens-grid { gap:2px; }.lens-grid button { font-size:6px; }.lens-grid button:before { width:2px; height:2px; left:2px; top:2px; }.graph-key { font-size:7px; gap:5px; }.controls { font-size:9px; }.controls select { font-size:9px; }.controls input[type=range] { width:45px; } header p { font-size:9px; } h1 { font-size:15px; } }
  @media(max-width:480px) { .body { grid-template-columns:minmax(0,1fr); }.inspector { display:none; }.graphic { min-height:200px; }.controls .check { display:none; }.graph-key { font-size:6px; } }
  .lens-navigation { display:flex; justify-content:space-between; align-items:center; gap:6px; margin-top:4px; }.lens-navigation button { border:1px solid var(--border); border-radius:4px; background:var(--background); padding:1px 8px; font-size:13px; }.lens-navigation span { font-size:8px; }
  .region-label { font-size:10px; }.column-title { font-size:10px; letter-spacing:.045em; }
  @media(max-width:650px) { .lens-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }.lens-grid button { font-size:9px; } }
</style>
