<script lang="ts">
  // Throwaway D: every Atlas note on explicit topic and note-metadata time axes.
  import type { AtlasNode } from '$lib/types/atlas';
  import { matchesQuery, topTopics, topicLabel, type PrototypeProps } from './types';

  let { response, selectedIds, query, onToggle, onAddMany, onPreview }: PrototypeProps = $props();
  let dateField = $state<'createdAtMillis' | 'updatedAtMillis'>('updatedAtMillis');
  let mode = $state<'inspect' | 'select'>('inspect');
  let linkScope = $state<'focused' | 'all' | 'none'>('focused');
  let linkKind = $state<'all' | 'semantic' | 'wikilink'>('all');
  let minStrength = $state(0.7);
  let rangeStart = $state(0);
  let rangeEnd = $state(100);
  let hoveredId = $state<string | null>(null);
  let focusedId = $state<string | null>(null);
  let width = $state(900);
  let height = $state(440);
  let svg: SVGSVGElement;
  let brush = $state<{ x1: number; y1: number; x2: number; y2: number; nodeId: string | null } | null>(null);
  const topics = $derived(topTopics(response));
  const selected = $derived(new Set(selectedIds));
  const nodesById = $derived(new Map(response.nodes.map((node) => [node.id, node])));
  const nodeTopic = $derived.by(() => {
    const membership = new Map<string, number>();
    topics.forEach((topic, index) => topic.memberNodeIds.forEach((id) => { if (!membership.has(id)) membership.set(id, index); }));
    return membership;
  });
  const hasUngrouped = $derived(response.nodes.some((node) => !nodeTopic.has(node.id)));
  const rows = $derived([
    ...topics.map((topic, index) => ({ id: topic.id, label: topicLabel(topic), color: `rgb(${topic.color[0]} ${topic.color[1]} ${topic.color[2]})`, index, count: response.nodes.filter((node) => nodeTopic.get(node.id) === index).length })),
    ...(hasUngrouped ? [{ id: '__ungrouped', label: 'Ungrouped', color: 'var(--muted-foreground)', index: topics.length, count: response.nodes.filter((node) => !nodeTopic.has(node.id)).length }] : [])
  ]);
  const dateBounds = $derived.by(() => {
    let min = Infinity, max = -Infinity, missing = 0;
    for (const node of response.nodes) {
      const value = dateOf(node);
      if (value === null) missing++;
      else { min = Math.min(min, value); max = Math.max(max, value); }
    }
    const valid = Number.isFinite(min);
    return { min: valid ? min : 0, max: valid ? max : 0, span: valid ? Math.max(max - min, 86_400_000) : 1, valid, missing };
  });
  const geometry = $derived({ left: Math.min(185, width * .25), right: width - (dateBounds.missing ? Math.min(90, width * .15) : 22), top: 14, bottom: height - 29 });
  const rowHeight = $derived((geometry.bottom - geometry.top) / Math.max(1, rows.length));
  const marks = $derived.by(() => {
    const raw = response.nodes.map((node) => {
      const row = nodeTopic.get(node.id) ?? topics.length;
      const time = dateOf(node);
      const actualX = time === null ? (geometry.right + 8 + width - 8) / 2 : geometry.left + (time - dateBounds.min) / dateBounds.span * (geometry.right - geometry.left - 8);
      return { node, row, time, actualX, color: rows[row]?.color || 'var(--muted-foreground)', matches: matchesQuery(node, query), inRange: time !== null && (time - dateBounds.min) / dateBounds.span * 100 >= Math.min(rangeStart, rangeEnd) && (time - dateBounds.min) / dateBounds.span * 100 <= Math.max(rangeStart, rangeEnd) };
    });
    const packed = new Map<string, { x: number; y: number; radius: number }>();
    for (const row of rows) {
      for (const unknown of [false, true]) {
        const members = raw.filter((mark) => mark.row === row.index && (mark.time === null) === unknown).sort((a, b) => a.actualX - b.actualX || a.node.id.localeCompare(b.node.id));
        const left = unknown ? geometry.right + 11 : geometry.left;
        const right = unknown ? width - 7 : geometry.right - 8;
        const centerY = geometry.top + (row.index + .5) * rowHeight;
        const coordinates = packRow(members, left, right, centerY, rowHeight);
        members.forEach((mark, index) => packed.set(mark.node.id, coordinates[index]));
      }
    }
    return raw.map((mark) => ({ ...mark, ...packed.get(mark.node.id)! }));
  });
  const maximumOffset = $derived(Math.ceil(marks.reduce((max, mark) => Math.max(max, Math.abs(mark.actualX - mark.x)), 0)));
  const positions = $derived(new Map(marks.map((mark) => [mark.node.id, mark])));
  const activeId = $derived(hoveredId || focusedId);
  const activeNode = $derived(activeId ? nodesById.get(activeId) : null);
  const bandActive = $derived(Math.min(rangeStart, rangeEnd) > 0 || Math.max(rangeStart, rangeEnd) < 100);
  const highlighted = $derived(marks.filter((mark) => mark.inRange && mark.matches));
  const visibleLinks = $derived(response.links.filter((link) => {
    if (linkScope === 'none' || !positions.has(link.sourceId) || !positions.has(link.targetId)) return false;
    if (linkKind !== 'all' && link.kind !== linkKind) return false;
    if (link.kind === 'semantic' && link.strength < minStrength) return false;
    return linkScope === 'all' || selected.has(link.sourceId) || selected.has(link.targetId) || activeId === link.sourceId || activeId === link.targetId;
  }));
  const ticks = $derived.by(() => {
    const count = width < 700 ? 4 : 6;
    return Array.from({ length: count }, (_, index) => {
      const fraction = index / (count - 1);
      return { x: geometry.left + fraction * (geometry.right - geometry.left - 8), value: dateBounds.min + fraction * dateBounds.span };
    });
  });

  function dateOf(node: AtlasNode): number | null {
    const value = node[dateField];
    return Number.isFinite(value) && value > 0 && value <= 8.64e15 ? value : null;
  }
  function packRow(members: { actualX: number }[], left: number, right: number, centerY: number, laneHeight: number): { x: number; y: number; radius: number }[] {
    // Deterministic collision packing; shrink the entire row only if its dense groups need it.
    const maxShift = 32;
    let radius = Math.min(3.25, Math.max(.7, (laneHeight - 3) / 3));
    for (let attempt = 0; attempt < 20; attempt++, radius *= .85) {
      const spacing = radius * 2 + Math.max(.25, radius * .22);
      const verticalSlots = Math.max(1, Math.floor((laneHeight - 2) / spacing));
      const ys = Array.from({ length: verticalSlots }, (_, i) => centerY + (i - (verticalSlots - 1) / 2) * spacing).sort((a, b) => Math.abs(a - centerY) - Math.abs(b - centerY) || a - b);
      const placed: { x: number; y: number; radius: number }[] = [];
      let failed = false;
      for (const member of members) {
        const baseX = Math.max(left + radius, Math.min(right - radius, member.actualX));
        let chosen: { x: number; y: number; radius: number } | null = null;
        const nearby = placed.filter((point) => Math.abs(point.x - baseX) <= maxShift + spacing);
        for (let column = 0; column <= Math.ceil(maxShift / spacing) && !chosen; column++) {
          for (const direction of column ? [-1, 1] : [0]) {
            const x = baseX + direction * column * spacing;
            if (x < left + radius || x > right - radius || Math.abs(x - member.actualX) > maxShift + radius) continue;
            for (const y of ys) {
              if (nearby.every((point) => (point.x - x) ** 2 + (point.y - y) ** 2 >= spacing ** 2 - .001)) { chosen = { x, y, radius }; break; }
            }
            if (chosen) break;
          }
        }
        if (!chosen) { failed = true; break; }
        placed.push(chosen);
      }
      if (!failed) return placed;
    }
    // Finite pixel resolution cannot separate arbitrarily large corpora; retain every glyph.
    return members.map((member, index) => ({ x: Math.max(left, Math.min(right, member.actualX + (index % 31 - 15) * .5)), y: centerY + (Math.floor(index / 31) % 7 - 3) * .3, radius: .35 }));
  }
  function formatDate(value: number | null, full = false) {
    if (value === null) return 'Unknown date';
    const options: Intl.DateTimeFormatOptions = full ? { dateStyle: 'medium', timeStyle: 'short' } : dateBounds.span <= 2 * 86_400_000 ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : dateBounds.span <= 90 * 86_400_000 ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' };
    return new Intl.DateTimeFormat(undefined, options).format(Math.max(-8.64e15, Math.min(8.64e15, value)));
  }
  function point(event: PointerEvent) {
    const matrix = svg.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
  }
  function startBrush(event: PointerEvent) {
    if (event.button !== 0 || mode !== 'select') return;
    const p = point(event);
    const target = event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
    brush = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, nodeId: target?.getAttribute('data-node-id') ?? null };
    svg.setPointerCapture(event.pointerId);
  }
  function moveBrush(event: PointerEvent) { if (brush) { const p = point(event); brush = { ...brush, x2: p.x, y2: p.y }; } }
  function finishBrush(event: PointerEvent) {
    if (!brush) return;
    const current = brush;
    if (Math.hypot(current.x2 - current.x1, current.y2 - current.y1) > 5) {
      onAddMany(marks.filter((mark) => mark.x >= Math.min(current.x1, current.x2) && mark.x <= Math.max(current.x1, current.x2) && mark.y >= Math.min(current.y1, current.y2) && mark.y <= Math.max(current.y1, current.y2)).map((mark) => mark.node.id));
    } else if (current.nodeId) { focusedId = current.nodeId; onToggle(current.nodeId); }
    brush = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }
  function clickNode(node: AtlasNode, event: MouseEvent) {
    // Select-mode pointer capture handles taps; keyboard clicks still use this path.
    if (mode === 'select' && event.detail !== 0) return;
    focusedId = node.id;
    onToggle(node.id);
  }
</script>

<section class="time-plot" aria-label="Topic by time visualization">
  <header>
    <div><p class="eyebrow">D / Topic × time</p><h2>See when ideas accumulate.</h2></div>
    <p class="coverage">{marks.length} / {response.nodes.length} notes plotted · {visibleLinks.length} links shown{dateBounds.missing ? ` · ${dateBounds.missing} unknown dates` : ''}</p>
  </header>
  <div class="toolbar">
    <label>Time axis <select bind:value={dateField}><option value="createdAtMillis">Note created</option><option value="updatedAtMillis">Note updated</option></select></label>
    <div class="mode" aria-label="Plot mode"><button class:active={mode === 'inspect'} onclick={() => mode = 'inspect'}>Inspect</button><button class:active={mode === 'select'} onclick={() => mode = 'select'}>Brush select</button></div>
    <label>Links <select bind:value={linkScope}><option value="focused">Hovered / selected</option><option value="all">All links</option><option value="none">No links</option></select></label>
    <label>Kind <select bind:value={linkKind}><option value="all">All kinds</option><option value="semantic">Semantic</option><option value="wikilink">Wikilinks</option></select></label>
    <label class="strength">Semantic strength ≥ {minStrength.toFixed(2)}<input type="range" min="0" max="1" step="0.05" bind:value={minStrength} /></label>
  </div>
  <div class="plot" bind:clientWidth={width} bind:clientHeight={height} class:selecting={mode === 'select'}>
    <svg bind:this={svg} viewBox={`0 0 ${width} ${height}`} aria-label="Every note positioned by metadata date and semantic topic" role="img" onpointerdown={startBrush} onpointermove={moveBrush} onpointerup={finishBrush} onpointercancel={() => brush = null}>
      <title>All notes by {dateField === 'createdAtMillis' ? 'creation' : 'update'} time and semantic topic. Click a note to select it; brush select adds every mark inside a rectangle.</title>
      {#each rows as row}
        <rect x={geometry.left} y={geometry.top + row.index * rowHeight} width={width - geometry.left - 8} height={rowHeight} fill={row.index % 2 ? 'var(--muted)' : 'var(--background)'} opacity="0.7" />
        <line x1={geometry.left} x2={width - 8} y1={geometry.top + (row.index + 1) * rowHeight} y2={geometry.top + (row.index + 1) * rowHeight} stroke="var(--border)" />
        <text x="8" y={geometry.top + (row.index + .5) * rowHeight} dominant-baseline="central" fill={row.color} style:font-size={`${Math.min(11, Math.max(7, rowHeight * .65))}px`} class="topic-label"><title>{row.label}</title>{row.label.length > (width < 700 ? 15 : 22) ? `${row.label.slice(0, width < 700 ? 13 : 20)}…` : row.label}</text>
        <text x={geometry.left - 9} y={geometry.top + (row.index + .5) * rowHeight} dominant-baseline="central" text-anchor="end" fill="var(--muted-foreground)" style:font-size={`${Math.min(10, Math.max(7, rowHeight * .62))}px`} class="count">{row.count}</text>
      {/each}
      {#if dateBounds.valid}
        {#each ticks as tick}
          <line x1={tick.x} x2={tick.x} y1={geometry.top} y2={geometry.bottom} stroke="var(--border)" stroke-dasharray="3 5" />
          <text x={tick.x} y={height - 20} text-anchor="middle" fill="var(--muted-foreground)" class="tick">{formatDate(tick.value)}</text>
        {/each}
      {:else}<text x={(geometry.left + geometry.right) / 2} y={height / 2} text-anchor="middle" fill="var(--muted-foreground)" class="tick">No valid note dates</text>{/if}
      {#if dateBounds.missing}
        <line x1={geometry.right + 8} x2={geometry.right + 8} y1={geometry.top} y2={geometry.bottom} stroke="var(--muted-foreground)" stroke-dasharray="3 4" />
        <text x={(geometry.right + width) / 2} y={height - 20} text-anchor="middle" fill="var(--muted-foreground)" class="tick">Unknown</text>
      {/if}
      {#if bandActive && dateBounds.valid}
        <rect x={geometry.left + Math.min(rangeStart, rangeEnd) / 100 * (geometry.right - geometry.left - 8)} y={geometry.top} width={Math.abs(rangeEnd - rangeStart) / 100 * (geometry.right - geometry.left - 8)} height={geometry.bottom - geometry.top} fill="var(--chart-2)" opacity=".1" pointer-events="none" />
      {/if}
      {#each visibleLinks as link}
        {@const a = positions.get(link.sourceId)!}
        {@const b = positions.get(link.targetId)!}
        <path d={`M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - Math.min(32, Math.abs(a.y - b.y) / 3)} ${b.x} ${b.y}`} fill="none" stroke={link.kind === 'wikilink' ? 'var(--foreground)' : 'var(--chart-2)'} stroke-width={link.kind === 'wikilink' ? 1.2 : .9} stroke-dasharray={link.kind === 'wikilink' ? '4 3' : undefined} opacity={linkScope === 'all' ? .22 : .5} pointer-events="none" />
      {/each}
      {#each marks as mark (mark.node.id)}
        {#if Math.abs(mark.x - mark.actualX) > mark.radius + 1}<line x1={mark.actualX} x2={mark.x} y1={mark.y} y2={mark.y} stroke={mark.color} stroke-width=".5" opacity=".2" pointer-events="none" />{/if}
        <circle data-node-id={mark.node.id} data-actual-x={mark.actualX} cx={mark.x} cy={mark.y} r={mark.radius} fill={mark.color} stroke={selected.has(mark.node.id) || activeId === mark.node.id ? 'var(--foreground)' : 'var(--background)'} stroke-width={selected.has(mark.node.id) || activeId === mark.node.id ? 1.5 : Math.min(.45, mark.radius / 3)} opacity={selected.has(mark.node.id) || activeId === mark.node.id ? 1 : !mark.matches || (bandActive && !mark.inRange) ? .2 : .85} role="button" tabindex="0" aria-label={`${mark.node.title || mark.node.fileName}, ${rows[mark.row]?.label || 'Ungrouped'}, ${formatDate(mark.time)}, ${selected.has(mark.node.id) ? 'selected' : 'not selected'}`} aria-pressed={selected.has(mark.node.id)} onclick={(event) => clickNode(mark.node, event)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusedId = mark.node.id; onToggle(mark.node.id); } }} onmouseenter={() => hoveredId = mark.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = mark.node.id} onblur={() => hoveredId = null}>
          <title>{mark.node.title || mark.node.fileName} · {formatDate(mark.time, true)} · {rows[mark.row]?.label || 'Ungrouped'}</title>
        </circle>
      {/each}
      {#if brush}
        <rect x={Math.min(brush.x1, brush.x2)} y={Math.min(brush.y1, brush.y2)} width={Math.abs(brush.x2 - brush.x1)} height={Math.abs(brush.y2 - brush.y1)} fill="var(--chart-2)" fill-opacity=".12" stroke="var(--chart-2)" stroke-dasharray="5 3" pointer-events="none" />
      {/if}
    </svg>
    {#if activeNode}
      <div class="tooltip" aria-live="polite">
        <div class="tooltip-heading"><strong>{activeNode.title || activeNode.fileName}</strong><button aria-label="Close note detail" onclick={() => { focusedId = null; hoveredId = null; }}>×</button></div>
        <p class="metadata">{rows[nodeTopic.get(activeNode.id) ?? topics.length]?.label || 'Ungrouped'} · {dateField === 'createdAtMillis' ? 'Created' : 'Updated'} {formatDate(dateOf(activeNode), true)}</p>
        <p class="excerpt">{activeNode.preview || 'No excerpt available.'}</p>
        <div class="tooltip-actions"><button onclick={() => onPreview(activeNode)}>Read preview</button><button onclick={() => onToggle(activeNode.id)}>{selected.has(activeNode.id) ? 'Remove from set' : 'Add to set'}</button></div>
      </div>
    {/if}
  </div>
  <div class="range-controls">
    <span>Highlight date band</span>
    <label>From <input type="range" min="0" max="100" step="1" bind:value={rangeStart} disabled={!dateBounds.valid} aria-label="Date band start" /></label>
    <label>To <input type="range" min="0" max="100" step="1" bind:value={rangeEnd} disabled={!dateBounds.valid} aria-label="Date band end" /></label>
    <span class="band-dates">{dateBounds.valid ? `${formatDate(dateBounds.min + Math.min(rangeStart, rangeEnd) / 100 * dateBounds.span)} — ${formatDate(dateBounds.min + Math.max(rangeStart, rangeEnd) / 100 * dateBounds.span)}` : 'No dated notes'}</span>
    <button disabled={!highlighted.length} onclick={() => onAddMany(highlighted.map((mark) => mark.node.id))}>Add {highlighted.length} highlighted</button>
    <button onclick={() => { rangeStart = 0; rangeEnd = 100; focusedId = null; }}>Reset all-vault view</button>
  </div>
  <p class="caption">{mode === 'select' ? 'Drag a rectangle to add enclosed notes; click a mark to toggle.' : 'Hover for an excerpt; click to select and keep detail open.'} Collision packing separates dots within topic rows, with up to {maximumOffset}px horizontal offset; hover shows the exact metadata date. Search and date bands dim without removing notes. Time is note metadata, not edit history. Dashed links: wikilinks; solid: semantic. Strength filters semantic links.</p>
</section>

<style>
  .time-plot {height:100%;min-height:0;display:flex;flex-direction:column;gap:8px;padding:7px 12px;color:var(--foreground);overflow:hidden}
  header {display:flex;justify-content:space-between;align-items:flex-end;gap:20px}
  .eyebrow {font-size:10px;letter-spacing:.13em;text-transform:uppercase;font-weight:650;color:var(--muted-foreground);margin:0 0 7px}
  h2 {font-size:17px;font-weight:550;letter-spacing:-.03em;margin:0}
  .coverage {font-size:11px;color:var(--muted-foreground);margin:0;text-align:right}
  .toolbar {display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
  label {display:flex;gap:7px;align-items:center;font-size:10px;color:var(--muted-foreground)}
  select,button {font-size:11px;color:var(--foreground);border:1px solid var(--border);border-radius:6px;background:var(--background);padding:5px 7px;cursor:pointer}
  button:hover {background:var(--accent)}
  button:disabled {opacity:.4;cursor:default}
  button:focus-visible,select:focus-visible,input:focus-visible {outline:2px solid var(--ring);outline-offset:2px}
  .mode {display:flex;gap:3px}.mode button.active {background:var(--primary);color:var(--primary-foreground)}
  .strength {margin-left:auto;display:flex;gap:9px}.strength input {width:85px}
  input[type=range] {accent-color:var(--primary);cursor:pointer}
  .plot {flex:1;min-height:200px;position:relative;width:100%;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--background)}
  svg {display:block;width:100%;height:100%}
  .plot.selecting svg {touch-action:none;cursor:crosshair}
  circle {cursor:pointer}circle:focus {outline:none;stroke:var(--foreground);stroke-width:3px}
  .topic-label {font-size:11px;font-weight:650}.tick,.count {font-size:9px}
  .tooltip {position:absolute;right:12px;top:12px;width:min(320px,calc(100% - 24px));border:1px solid var(--border);border-radius:10px;padding:13px;background:var(--card);box-shadow:var(--shadow-lg)}
  .tooltip-heading {display:flex;align-items:flex-start;gap:12px;justify-content:space-between}.tooltip-heading strong {font-size:13px;line-height:1.4}.tooltip-heading button {padding:0 4px;border:0;background:transparent;font-size:17px}
  .metadata {font-size:10px;color:var(--muted-foreground);margin:9px 0;line-height:1.5}
  .excerpt {font-size:11px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
  .tooltip-actions {display:flex;gap:7px}
  .range-controls {display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:10px;color:var(--muted-foreground)}
  .range-controls>span:first-child {font-weight:600}.range-controls input {width:90px}.band-dates {margin-right:auto}
  .caption {font-size:10px;line-height:1.6;color:var(--muted-foreground);margin:0}
  @media(max-width:760px) {.time-plot {padding:12px;gap:9px;min-height:610px}h2 {font-size:19px}header {align-items:flex-start;flex-direction:column;gap:7px}.coverage {text-align:left}.toolbar {gap:7px;padding:8px 0}.toolbar label {font-size:9px}.strength {margin-left:0}.topic-label {font-size:9px}.tooltip {width:240px}.band-dates {flex-basis:100%}.plot {min-height:310px}}
  header .eyebrow{display:none}
</style>
