<script lang="ts">
  // Throwaway H: all-vault projection from recorded semantic graph links, never inferred embeddings.
  import type { AtlasNode } from '$lib/types/atlas';
  import { matchesQuery, topTopics, topicLabel, type PrototypeProps } from './types';

  let { response, selectedIds, query, onToggle, onAddMany, onPreview }: PrototypeProps = $props();
  type Metric = 'max' | 'mean';
  type Affinity = { value: number; count: number };
  type Geometry = { left: number; right: number; top: number; bottom: number };
  let draftX = $state('');
  let draftY = $state('');
  let draftMetric = $state<Metric>('max');
  let anchors = $state<{ x: string; y: string; metric: Metric }>({ x: '', y: '', metric: 'max' });
  let cutX = $state(.65);
  let cutY = $state(.65);
  let highlight = $state<'all' | 'both' | 'x' | 'y' | 'neither'>('all');
  let mode = $state<'inspect' | 'select'>('inspect');
  let showEdges = $state(false);
  let showWikilinks = $state(false);
  let hoveredId = $state<string | null>(null);
  let focusedId = $state<string | null>(null);
  let width = $state(900);
  let height = $state(380);
  let layoutWidth = $state(900);
  let layoutHeight = $state(380);
  let svg: SVGSVGElement;
  let brush = $state<{ x1: number; y1: number; x2: number; y2: number; nodeId: string | null } | null>(null);
  // Hidden comparison variants report zero dimensions; retain their last usable geometry.
  $effect(() => { if (width > 100) layoutWidth = width; if (height > 100) layoutHeight = height; });

  const topics = $derived(topTopics(response));
  const noteOptions = $derived([...response.nodes].sort((a, b) => (a.title || a.fileName).localeCompare(b.title || b.fileName) || a.id.localeCompare(b.id)));
  const nodeById = $derived(new Map(response.nodes.map((node) => [node.id, node])));
  const selected = $derived(new Set(selectedIds));
  const anchorOptions = $derived([
    ...topics.map((topic) => ({ key: `topic:${topic.id}`, label: topicLabel(topic), members: new Set(topic.memberNodeIds), kind: 'Topic' })),
    ...noteOptions.map((node) => ({ key: `note:${node.id}`, label: node.title || node.fileName, members: new Set([node.id]), kind: 'Note' }))
  ]);
  const xAnchor = $derived(anchorOptions.find((item) => item.key === anchors.x));
  const yAnchor = $derived(anchorOptions.find((item) => item.key === anchors.y));
  const pending = $derived(draftX !== anchors.x || draftY !== anchors.y || draftMetric !== anchors.metric);
  $effect(() => {
    if (!anchors.x && anchorOptions.length) {
      const x = anchorOptions[0].key;
      const y = anchorOptions[1]?.key || x;
      draftX = x; draftY = y;
      anchors = { x, y, metric: 'max' };
    }
  });
  const neighbors = $derived.by(() => {
    const graph = new Map<string, Map<string, number>>();
    for (const link of response.links) {
      if (link.kind !== 'semantic' || !Number.isFinite(link.strength) || link.sourceId === link.targetId) continue;
      if (!nodeById.has(link.sourceId) || !nodeById.has(link.targetId)) continue;
      const strength = Math.max(0, Math.min(1, link.strength));
      for (const [source, target] of [[link.sourceId, link.targetId], [link.targetId, link.sourceId]]) {
        const adjacency = graph.get(source) || new Map<string, number>();
        adjacency.set(target, Math.max(adjacency.get(target) ?? -Infinity, strength));
        graph.set(source, adjacency);
      }
    }
    return graph;
  });
  const profiles = $derived(response.nodes.map((node) => {
    const topic = topics.find((item) => item.memberNodeIds.includes(node.id));
    return { node, x: recordedAffinity(node.id, xAnchor?.members || new Set(), neighbors, anchors.metric), y: recordedAffinity(node.id, yAnchor?.members || new Set(), neighbors, anchors.metric), color: topic ? `rgb(${topic.color[0]} ${topic.color[1]} ${topic.color[2]})` : 'var(--muted-foreground)' };
  }));
  const geometry = $derived({ left: 54, right: Math.max(100, layoutWidth - 16), top: 15, bottom: Math.max(65, layoutHeight - 50) });
  const marks = $derived.by(() => {
    const raw = profiles.map((profile) => ({ ...profile, actualX: geometry.left + profile.x.value * (geometry.right - geometry.left), actualY: geometry.bottom - profile.y.value * (geometry.bottom - geometry.top) }));
    const packed = packProfiles(raw, geometry);
    return raw.map((mark) => ({ ...mark, ...packed.get(mark.node.id)! }));
  });
  const positions = $derived(new Map(marks.map((mark) => [mark.node.id, mark])));
  const maximumOffset = $derived(Math.ceil(marks.reduce((maximum, mark) => Math.max(maximum, Math.hypot(mark.px - mark.actualX, mark.py - mark.actualY)), 0)));
  const activeId = $derived(hoveredId || focusedId);
  const activeMark = $derived(activeId ? positions.get(activeId) : null);
  const unknownCount = $derived(profiles.filter((profile) => !profile.x.count && !profile.y.count).length);
  const cornerIds = $derived(profiles.filter((profile) => inCorner(profile.x, profile.y) && matchesQuery(profile.node, query)).map((profile) => profile.node.id));
  const visibleEdges = $derived(showEdges ? response.links.filter((link) => positions.has(link.sourceId) && positions.has(link.targetId) && (link.kind === 'semantic' || showWikilinks) && (selected.has(link.sourceId) || selected.has(link.targetId) || link.sourceId === activeId || link.targetId === activeId)) : []);

  function recordedAffinity(nodeId: string, members: Set<string>, graph: Map<string, Map<string, number>>, metric: Metric): Affinity {
    const strengths: number[] = [];
    for (const [neighbor, strength] of graph.get(nodeId) || []) if (neighbor !== nodeId && members.has(neighbor)) strengths.push(strength);
    if (!strengths.length) return { value: 0, count: 0 };
    return { value: metric === 'max' ? Math.max(...strengths) : strengths.reduce((sum, value) => sum + value, 0) / strengths.length, count: strengths.length };
  }
  function inCorner(x: Affinity, y: Affinity) {
    const overX = x.count > 0 && x.value >= cutX, overY = y.count > 0 && y.value >= cutY;
    return highlight === 'all' || (highlight === 'both' && overX && overY) || (highlight === 'x' && overX && !overY) || (highlight === 'y' && !overX && overY) || (highlight === 'neither' && !overX && !overY);
  }
  function packProfiles(raw: { node: AtlasNode; actualX: number; actualY: number }[], bounds: Geometry) {
    const ordered = [...raw].sort((a, b) => a.actualX - b.actualX || a.actualY - b.actualY || a.node.id.localeCompare(b.node.id));
    const buckets = new Map<string, number>();
    for (const mark of ordered) { const key = `${Math.round(mark.actualX / 30)}:${Math.round(mark.actualY / 30)}`; buckets.set(key, (buckets.get(key) || 0) + 1); }
    const densest = Math.max(1, ...buckets.values());
    // Start smaller for a large no-recorded-affinity pile at an axis corner.
    let radius = Math.min(3.2, Math.sqrt(30 * 30 * .65 / densest) / 2.25);
    for (let attempt = 0; attempt < 18; attempt++, radius *= .85) {
      const step = radius * 2.25;
      const slots: { dx: number; dy: number }[] = [];
      const rings = Math.ceil(30 / step);
      for (let ix = -rings; ix <= rings; ix++) for (let iy = -rings; iy <= rings; iy++) if (Math.hypot(ix * step, iy * step) <= 30) slots.push({ dx: ix * step, dy: iy * step });
      slots.sort((a, b) => a.dx ** 2 + a.dy ** 2 - b.dx ** 2 - b.dy ** 2 || a.dy - b.dy || a.dx - b.dx);
      const packed = new Map<string, { px: number; py: number; radius: number }>();
      const cells = new Map<string, { px: number; py: number }[]>();
      let failed = false;
      for (const mark of ordered) {
        const originX = Math.max(bounds.left + radius, Math.min(bounds.right - radius, mark.actualX));
        const originY = Math.max(bounds.top + radius, Math.min(bounds.bottom - radius, mark.actualY));
        let found = false;
        for (const slot of slots) {
          const px = originX + slot.dx, py = originY + slot.dy;
          if (px < bounds.left + radius || px > bounds.right - radius || py < bounds.top + radius || py > bounds.bottom - radius) continue;
          const cx = Math.floor(px / step), cy = Math.floor(py / step);
          let collision = false;
          for (let x = cx - 1; x <= cx + 1 && !collision; x++) for (let y = cy - 1; y <= cy + 1 && !collision; y++) if ((cells.get(`${x}:${y}`) || []).some((other) => Math.hypot(other.px - px, other.py - py) < step - .001)) collision = true;
          if (collision) continue;
          packed.set(mark.node.id, { px, py, radius });
          const cell = cells.get(`${cx}:${cy}`) || []; cell.push({ px, py }); cells.set(`${cx}:${cy}`, cell);
          found = true; break;
        }
        if (!found) { failed = true; break; }
      }
      if (!failed) return packed;
    }
    // Preserve all glyphs even beyond finite screen resolution.
    return new Map(ordered.map((mark, index) => [mark.node.id, { px: Math.max(bounds.left, Math.min(bounds.right, mark.actualX + index % 13)), py: Math.max(bounds.top, Math.min(bounds.bottom, mark.actualY - Math.floor(index / 13) % 13)), radius: .3 }]));
  }
  function reproject() { anchors = { x: draftX, y: draftY, metric: draftMetric }; focusedId = null; hoveredId = null; }
  function clearSelection() { for (const id of [...selectedIds]) onToggle(id); }
  function point(event: PointerEvent) { const matrix = svg.getScreenCTM(); return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : { x: 0, y: 0 }; }
  function startBrush(event: PointerEvent) {
    if (event.button !== 0 || mode !== 'select') return;
    const p = point(event);
    const target = event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
    brush = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, nodeId: target?.getAttribute('data-node-id') || null };
    svg.setPointerCapture(event.pointerId);
  }
  function moveBrush(event: PointerEvent) { if (brush) { const p = point(event); brush = { ...brush, x2: p.x, y2: p.y }; } }
  function finishBrush(event: PointerEvent) {
    if (!brush) return;
    if (Math.hypot(brush.x2 - brush.x1, brush.y2 - brush.y1) > 5) onAddMany(marks.filter((mark) => mark.px >= Math.min(brush!.x1, brush!.x2) && mark.px <= Math.max(brush!.x1, brush!.x2) && mark.py >= Math.min(brush!.y1, brush!.y2) && mark.py <= Math.max(brush!.y1, brush!.y2)).map((mark) => mark.node.id));
    else if (brush.nodeId) { focusedId = brush.nodeId; onToggle(brush.nodeId); }
    brush = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }
  function shortLabel(label: string, limit = 35) { return label.length > limit ? `${label.slice(0, limit - 1)}…` : label; }
  function affinityLabel(affinity: Affinity) { return affinity.count ? `${affinity.value.toFixed(3)} · ${affinity.count} recorded neighbor${affinity.count === 1 ? '' : 's'}` : 'No recorded affinity'; }
</script>

<section class="compass" aria-label="Similarity compass visualization">
  <header><div><p class="eyebrow">H / Similarity compass</p><h2>Two anchors. A new view of every note.</h2></div><p class="coverage">{marks.length} / {response.nodes.length} notes · {unknownCount} with neither affinity recorded</p></header>
  <div class="anchors">
    <label>X anchor <select bind:value={draftX} aria-label="Horizontal affinity anchor"><optgroup label="Topics">{#each anchorOptions.filter((item) => item.kind === 'Topic') as option}<option value={option.key}>{option.label}</option>{/each}</optgroup><optgroup label="Individual notes">{#each anchorOptions.filter((item) => item.kind === 'Note') as option}<option value={option.key}>{option.label}</option>{/each}</optgroup></select></label>
    <label>Y anchor <select bind:value={draftY} aria-label="Vertical affinity anchor"><optgroup label="Topics">{#each anchorOptions.filter((item) => item.kind === 'Topic') as option}<option value={option.key}>{option.label}</option>{/each}</optgroup><optgroup label="Individual notes">{#each anchorOptions.filter((item) => item.kind === 'Note') as option}<option value={option.key}>{option.label}</option>{/each}</optgroup></select></label>
    <label>Metric <select bind:value={draftMetric}><option value="max">Strongest recorded link</option><option value="mean">Mean recorded links</option></select></label>
    <button class="project" disabled={!draftX || !draftY} onclick={reproject}>{pending ? 'Reproject vault •' : 'Reproject vault'}</button>
  </div>
  <div class="tools">
    <div class="modes"><button class:active={mode === 'inspect'} onclick={() => mode = 'inspect'}>Inspect</button><button class:active={mode === 'select'} onclick={() => mode = 'select'}>Brush select</button></div>
    <label><input type="checkbox" bind:checked={showEdges} />Selected / hovered edges</label><label><input type="checkbox" bind:checked={showWikilinks} />Wikilinks overlay only</label><button disabled={!selectedIds.length} onclick={clearSelection}>Clear {selectedIds.length} selected</button>
  </div>
  <div class="plot" class:selecting={mode === 'select'} bind:clientWidth={width} bind:clientHeight={height}>
    <svg bind:this={svg} viewBox={`0 0 ${layoutWidth} ${layoutHeight}`} role="img" aria-label="All notes by recorded semantic affinity to two anchors" onpointerdown={startBrush} onpointermove={moveBrush} onpointerup={finishBrush} onpointercancel={() => brush = null}>
      <title>Every note projected by {anchors.metric === 'max' ? 'strongest' : 'mean'} recorded semantic link strength to {xAnchor?.label || 'X anchor'} and {yAnchor?.label || 'Y anchor'}. Hollow marks have neither affinity recorded. Zero does not mean dissimilar.</title>
      <rect x={geometry.left} y={geometry.top} width={geometry.right - geometry.left} height={geometry.bottom - geometry.top} fill="var(--background)" />
      {#each [0, .25, .5, .75, 1] as tick}
        <line x1={geometry.left + tick * (geometry.right - geometry.left)} x2={geometry.left + tick * (geometry.right - geometry.left)} y1={geometry.top} y2={geometry.bottom} stroke="var(--border)" stroke-dasharray="3 5" />
        <line x1={geometry.left} x2={geometry.right} y1={geometry.bottom - tick * (geometry.bottom - geometry.top)} y2={geometry.bottom - tick * (geometry.bottom - geometry.top)} stroke="var(--border)" stroke-dasharray="3 5" />
        <text x={geometry.left + tick * (geometry.right - geometry.left)} y={geometry.bottom + 15} text-anchor="middle" class="tick">{tick.toFixed(2)}</text>
        <text x={geometry.left - 8} y={geometry.bottom - tick * (geometry.bottom - geometry.top)} dominant-baseline="central" text-anchor="end" class="tick">{tick.toFixed(2)}</text>
      {/each}
      <rect x={geometry.left + cutX * (geometry.right - geometry.left)} y={geometry.top} width={(1 - cutX) * (geometry.right - geometry.left)} height={(1 - cutY) * (geometry.bottom - geometry.top)} fill="var(--chart-2)" opacity=".045" />
      <line x1={geometry.left + cutX * (geometry.right - geometry.left)} x2={geometry.left + cutX * (geometry.right - geometry.left)} y1={geometry.top} y2={geometry.bottom} stroke="var(--muted-foreground)" stroke-dasharray="5 4" />
      <line x1={geometry.left} x2={geometry.right} y1={geometry.bottom - cutY * (geometry.bottom - geometry.top)} y2={geometry.bottom - cutY * (geometry.bottom - geometry.top)} stroke="var(--muted-foreground)" stroke-dasharray="5 4" />
      <text x={geometry.right - 9} y={geometry.top + 13} text-anchor="end" class="quadrant">Both over cuts</text>
      <text x={geometry.left + 7} y={geometry.top + 13} class="quadrant">Y over cut</text>
      <text x={geometry.right - 9} y={geometry.bottom - 8} text-anchor="end" class="quadrant">X over cut</text>
      {#each visibleEdges as edge}
        {@const from = positions.get(edge.sourceId)!}{@const to = positions.get(edge.targetId)!}
        <line x1={from.px} x2={to.px} y1={from.py} y2={to.py} stroke={edge.kind === 'wikilink' ? 'var(--foreground)' : 'var(--chart-2)'} stroke-dasharray={edge.kind === 'wikilink' ? '4 3' : undefined} opacity=".35" stroke-width=".85" pointer-events="none" />
      {/each}
      {#each marks as mark (mark.node.id)}
        <circle data-node-id={mark.node.id} data-affinity-x={mark.x.count ? mark.x.value : 'unknown'} data-affinity-y={mark.y.count ? mark.y.value : 'unknown'} cx={mark.px} cy={mark.py} r={mark.radius} fill={!mark.x.count && !mark.y.count ? 'var(--background)' : mark.color} stroke={selected.has(mark.node.id) || activeId === mark.node.id ? 'var(--foreground)' : mark.color} stroke-width={selected.has(mark.node.id) || activeId === mark.node.id ? 1.5 : Math.min(.8, mark.radius / 2)} opacity={selected.has(mark.node.id) || activeId === mark.node.id ? 1 : matchesQuery(mark.node, query) && inCorner(mark.x, mark.y) ? .9 : .18} role="button" tabindex="0" aria-label={`${mark.node.title || mark.node.fileName}; X: ${affinityLabel(mark.x)}; Y: ${affinityLabel(mark.y)}`} aria-pressed={selected.has(mark.node.id)} onclick={(event) => { if (mode === 'select' && event.detail !== 0) return; focusedId = mark.node.id; onToggle(mark.node.id); }} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusedId = mark.node.id; onToggle(mark.node.id); } }} onmouseenter={() => hoveredId = mark.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = mark.node.id} onblur={() => hoveredId = null}>
          <title>{mark.node.title || mark.node.fileName} · X: {affinityLabel(mark.x)} · Y: {affinityLabel(mark.y)}</title>
        </circle>
      {/each}
      <text x={(geometry.left + geometry.right) / 2} y={layoutHeight - 9} text-anchor="middle" class="axis-label"><title>{xAnchor?.label}</title>X → {shortLabel(xAnchor?.label || 'Choose an anchor', layoutWidth < 650 ? 32 : 58)}</text>
      <text transform={`translate(11 ${(geometry.top + geometry.bottom) / 2}) rotate(-90)`} text-anchor="middle" class="axis-label"><title>{yAnchor?.label}</title>Y → {shortLabel(yAnchor?.label || 'Choose an anchor', 31)}</text>
      {#if brush}<rect x={Math.min(brush.x1, brush.x2)} y={Math.min(brush.y1, brush.y2)} width={Math.abs(brush.x2 - brush.x1)} height={Math.abs(brush.y2 - brush.y1)} fill="var(--chart-2)" fill-opacity=".12" stroke="var(--chart-2)" stroke-dasharray="4 3" pointer-events="none" />{/if}
    </svg>
    {#if activeMark}
      <aside class="inspector" aria-live="polite"><div class="inspector-title"><strong>{activeMark.node.title || activeMark.node.fileName}</strong><button aria-label="Close compass note detail" onclick={() => { focusedId = null; hoveredId = null; }}>×</button></div><p>X / {xAnchor?.label}: <b>{affinityLabel(activeMark.x)}</b></p><p>Y / {yAnchor?.label}: <b>{affinityLabel(activeMark.y)}</b></p><p class="excerpt">{activeMark.node.preview || 'No excerpt in this snapshot.'}</p><div><button onclick={() => onPreview(activeMark.node)}>Read preview</button><button onclick={() => onToggle(activeMark.node.id)}>{selected.has(activeMark.node.id) ? 'Remove from set' : 'Add to set'}</button></div></aside>
    {/if}
  </div>
  <div class="thresholds"><label>X cut {cutX.toFixed(2)}<input type="range" min="0" max="1" step=".05" bind:value={cutX} /></label><label>Y cut {cutY.toFixed(2)}<input type="range" min="0" max="1" step=".05" bind:value={cutY} /></label><label>Highlight<select bind:value={highlight}><option value="all">Every note</option><option value="both">Both over cuts</option><option value="x">X only over cut</option><option value="y">Y only over cut</option><option value="neither">Neither over cuts</option></select></label><button disabled={!cornerIds.length} onclick={() => onAddMany(cornerIds)}>Add {cornerIds.length} highlighted</button></div>
  <p class="caption">Axes: {anchors.metric === 'max' ? 'strongest' : 'mean of'} recorded semantic link strengths to distinct anchor neighbors; self-scores are never invented. Missing links mean unknown affinity, plotted at zero, not dissimilarity. Packing offsets marks ≤{maximumOffset}px; exact values appear on hover. Search dims without reprojecting. Wikilinks affect the optional edge overlay only.</p>
</section>

<style>
  .compass{height:100%;min-height:0;display:flex;flex-direction:column;gap:8px;padding:7px 12px;color:var(--foreground);overflow:hidden}
  header{display:flex;align-items:flex-end;justify-content:space-between;gap:15px}.eyebrow{display:none}h2{font-size:17px;font-weight:550;letter-spacing:-.03em;margin:0}.coverage{font-size:10px;color:var(--muted-foreground);margin:0;text-align:right}
  .anchors,.tools,.thresholds{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.anchors{padding:6px 0;border-block:1px solid var(--border)}label{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted-foreground);min-width:0}.anchors label{flex:1}.anchors select{width:100%;max-width:245px;min-width:70px}.anchors label:last-of-type{flex:0 1 205px}
  select,button{font-size:10px;border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);padding:5px 7px;cursor:pointer}button:hover{background:var(--accent)}button:disabled{opacity:.4;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--ring);outline-offset:2px}.project{background:var(--primary);color:var(--primary-foreground)}.project:hover{background:color-mix(in oklab,var(--primary) 85%,var(--background))}.modes{display:flex;gap:3px}.modes .active{background:var(--primary);color:var(--primary-foreground)}input{accent-color:var(--primary)}.tools>button:last-child{margin-left:auto}
  .plot{position:relative;flex:1;min-height:200px;border:1px solid var(--border);border-radius:8px;background:var(--background);overflow:hidden}svg{width:100%;height:100%;display:block}.selecting svg{cursor:crosshair;touch-action:none}circle{cursor:pointer}circle:focus{outline:none;stroke:var(--foreground);stroke-width:2px}.tick{font-size:9px;fill:var(--muted-foreground)}.axis-label{font-size:10px;fill:var(--foreground)}.quadrant{font-size:9px;fill:var(--muted-foreground);pointer-events:none}
  .inspector{position:absolute;right:12px;top:30px;width:min(290px,calc(100% - 24px));padding:12px;background:var(--card);border:1px solid var(--border);border-radius:9px;box-shadow:var(--shadow-lg)}.inspector-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.inspector strong{font-size:12px;line-height:1.4}.inspector-title button{border:0;background:transparent;padding:0 4px;font-size:16px}.inspector p{font-size:10px;color:var(--muted-foreground);line-height:1.5;margin:8px 0;overflow-wrap:anywhere}.inspector b{font-weight:500;color:var(--foreground)}.inspector .excerpt{display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:11px}.inspector>div:last-child{display:flex;gap:7px}.thresholds input{width:85px}.thresholds>button{margin-left:auto}.caption{font-size:9px;line-height:1.5;color:var(--muted-foreground);margin:0}
  @media(max-width:760px){.compass{height:auto;min-height:560px;padding:7px 9px;gap:7px;overflow:visible}header,.anchors,.tools,.thresholds,.caption{flex-shrink:0}header{align-items:flex-start;flex-direction:column;gap:4px}h2{font-size:15px}.coverage{text-align:left}.anchors label{flex:1 1 42%}.anchors label:last-of-type{flex:1 1 42%}.anchors select{max-width:none}.tools{gap:6px}.tools label{font-size:9px}.plot{min-height:190px;flex-shrink:0}.thresholds{gap:6px}.thresholds input{width:65px}.thresholds>button{margin-left:0}.inspector{width:235px;right:8px}.caption{font-size:8px}}
</style>
