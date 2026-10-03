<script lang="ts">
  import type { AtlasLink, AtlasNode } from '$lib/types/atlas';
  import { matchesQuery, topTopics, topicLabel, type PrototypeProps } from './types';

  let { response, selectedIds, query, onToggle, onAddMany, onPreview }: PrototypeProps = $props();
  let order = $state<'topics' | 'alphabetical' | 'connections'>('topics');
  let kind = $state<'all' | 'semantic' | 'wikilink'>('all');
  let threshold = $state(0);
  let focus = $state<{ row: number; column: number } | null>(null);
  let pinned = $state(false);
  let showLens = $state(false);
  let lensCenter = $state({ row: 0, column: 0 });
  let svg: SVGSVGElement;
  const size = 800;
  const selected = $derived(new Set(selectedIds));
  const topics = $derived(topTopics(response));
  const topicFor = $derived.by(() => {
    const result = new Map<string, { id: string; label: string; color: string }>();
    for (const topic of topics) {
      for (const id of topic.memberNodeIds) {
        if (!result.has(id)) result.set(id, { id: topic.id, label: topicLabel(topic), color: `rgb(${topic.color.slice(0, 3).join(',')})` });
      }
    }
    return result;
  });
  const nodeIds = $derived(new Set(response.nodes.map((node) => node.id)));
  const pairs = $derived.by(() => {
    const result = new Map<string, AtlasLink[]>();
    for (const link of response.links) {
      if (link.sourceId === link.targetId || !nodeIds.has(link.sourceId) || !nodeIds.has(link.targetId)) continue;
      const key = pairKey(link.sourceId, link.targetId);
      result.set(key, [...(result.get(key) ?? []), link]);
    }
    return result;
  });
  const degrees = $derived.by(() => {
    const result = new Map<string, Set<string>>();
    for (const links of pairs.values()) {
      const link = links[0];
      if (!result.has(link.sourceId)) result.set(link.sourceId, new Set());
      if (!result.has(link.targetId)) result.set(link.targetId, new Set());
      result.get(link.sourceId)?.add(link.targetId);
      result.get(link.targetId)?.add(link.sourceId);
    }
    return result;
  });
  const nodes = $derived([...response.nodes].sort((a, b) => {
    if (order === 'topics') {
      const at = topicFor.get(a.id), bt = topicFor.get(b.id);
      if (!!at !== !!bt) return at ? -1 : 1;
      const topicCompare = (at?.label ?? '').localeCompare(bt?.label ?? '') || (at?.id ?? '').localeCompare(bt?.id ?? '');
      if (topicCompare) return topicCompare;
    }
    if (order === 'connections') {
      const difference = (degrees.get(b.id)?.size ?? 0) - (degrees.get(a.id)?.size ?? 0);
      if (difference) return difference;
    }
    return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  }));
  const step = $derived(size / Math.max(1, nodes.length));
  const indexes = $derived(new Map(nodes.map((node, index) => [node.id, index])));
  const matching = $derived(new Set(nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id)));
  const bands = $derived.by(() => {
    const result: { start: number; count: number; label: string; color: string }[] = [];
    let lastId: string | null = null;
    nodes.forEach((node, index) => {
      const topic = topicFor.get(node.id);
      const id = topic?.id ?? '__ungrouped';
      if (id !== lastId) result.push({ start: index, count: 1, label: topic?.label ?? 'Ungrouped', color: topic?.color ?? 'var(--muted-foreground)' });
      else result[result.length - 1].count++;
      lastId = id;
    });
    return result;
  });
  const cells = $derived.by(() => {
    const result: { row: number; column: number; semantic: number | null; wikilink: number | null }[] = [];
    for (const links of pairs.values()) {
      const allowed = links.filter(accepts);
      if (!allowed.length) continue;
      const row = indexes.get(links[0].sourceId), column = indexes.get(links[0].targetId);
      if (row === undefined || column === undefined) continue;
      const semantic = allowed.filter((link) => link.kind === 'semantic');
      const wikilink = allowed.filter((link) => link.kind === 'wikilink');
      const cell = { row, column, semantic: semantic.length ? Math.max(...semantic.map((link) => link.strength)) : null, wikilink: wikilink.length ? Math.max(...wikilink.map((link) => link.strength)) : null };
      result.push(cell, { ...cell, row: column, column: row });
    }
    return result;
  });
  const rowNode = $derived(focus ? nodes[focus.row] : null);
  const columnNode = $derived(focus ? nodes[focus.column] : null);
  const focusLinks = $derived(rowNode && columnNode ? pairs.get(pairKey(rowNode.id, columnNode.id)) ?? [] : []);
  const shownLinks = $derived(focusLinks.filter(accepts));
  const dimmedCount = $derived(nodes.length - matching.size);
  const lensCount = $derived(Math.min(7, nodes.length));
  const lensStart = $derived({ row: Math.max(0, Math.min(nodes.length - lensCount, lensCenter.row - Math.floor(lensCount / 2))), column: Math.max(0, Math.min(nodes.length - lensCount, lensCenter.column - Math.floor(lensCount / 2))) });
  const lensRows = $derived(nodes.slice(lensStart.row, lensStart.row + lensCount));
  const lensColumns = $derived(nodes.slice(lensStart.column, lensStart.column + lensCount));

  function pairKey(a: string, b: string) { return a < b ? `${a}\0${b}` : `${b}\0${a}`; }
  function accepts(link: AtlasLink) { return (kind === 'all' || kind === link.kind) && link.strength >= threshold; }
  function inspect(row: number, column: number, moveLens = true) {
    focus = { row, column };
    if (moveLens) lensCenter = { row, column };
  }
  function lensColor(row: AtlasNode, column: AtlasNode) {
    if (row.id === column.id) return 'var(--muted)';
    const links = (pairs.get(pairKey(row.id, column.id)) ?? []).filter(accepts);
    const semantic = links.filter((link) => link.kind === 'semantic');
    const explicit = links.filter((link) => link.kind === 'wikilink');
    const teal = `rgba(23,137,132,${0.3 + Math.max(0, ...semantic.map((link) => link.strength)) * 0.7})`;
    const orange = `rgba(193,93,37,${0.3 + Math.max(0, ...explicit.map((link) => link.strength)) * 0.7})`;
    if (semantic.length && explicit.length) return `linear-gradient(45deg, ${teal} 50%, ${orange} 50%)`;
    return explicit.length ? orange : semantic.length ? teal : 'var(--background)';
  }
  function move(event: PointerEvent) {
    if (pinned || !nodes.length) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    if (point.x >= 0 && point.y >= 0 && point.x < size && point.y < size) {
      inspect(Math.floor(point.y / step), Math.floor(point.x / step));
    } else if (point.x >= -40 && point.x < 0 && point.y >= 0 && point.y < size) {
      const row = Math.floor(point.y / step); inspect(row, row);
    } else if (point.y >= -40 && point.y < 0 && point.x >= 0 && point.x < size) {
      const column = Math.floor(point.x / step); inspect(column, column);
    }
  }
  function cellClick(event: MouseEvent | undefined = undefined) {
    if (event) {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      if (point.x < 0 || point.y < 0 || point.x >= size || point.y >= size || !nodes.length) return;
      inspect(Math.floor(point.y / step), Math.floor(point.x / step));
    }
    if (!rowNode || !columnNode) return;
    if (rowNode.id === columnNode.id) onToggle(rowNode.id);
    else onAddMany([rowNode.id, columnNode.id]);
    pinned = true;
  }
  function keyboard(event: KeyboardEvent) {
    if (!nodes.length) return;
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'];
    if (!keys.includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const current = focus ? { row: Math.min(nodes.length - 1, focus.row), column: Math.min(nodes.length - 1, focus.column) } : { row: 0, column: 0 };
    if (event.key === 'Escape') { pinned = false; return; }
    if (event.key === 'Enter') { focus = current; cellClick(); return; }
    if (event.key === ' ') { onToggle(nodes[current.row].id); return; }
    pinned = false;
    inspect(Math.max(0, Math.min(nodes.length - 1, current.row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0))), Math.max(0, Math.min(nodes.length - 1, current.column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))));
  }
  function topic(node: AtlasNode) { return topicFor.get(node.id)?.label ?? 'Ungrouped'; }
</script>

<section class="matrix-workspace">
  <header><div><span class="eyebrow">B / relationship matrix</span><h1>Where ideas connect</h1><p>Every note on both axes. Dense blocks reveal communities; off-diagonal cells expose bridges.</p></div><div class="coverage"><strong>{nodes.length} × {nodes.length}</strong><span>whole vault · {cells.length / 2} visible linked pairs</span></div></header>
  <div class="controls">
    <label>Order <select bind:value={order} onchange={() => { focus = null; pinned = false; }}><option value="topics">Topic blocks</option><option value="alphabetical">Alphabetical</option><option value="connections">Most connections</option></select></label>
    <label>Relationships <select bind:value={kind}><option value="all">All kinds</option><option value="semantic">Semantic only</option><option value="wikilink">Explicit links only</option></select></label>
    <label class="threshold">Min strength <input type="range" min="0" max="1" step="0.05" bind:value={threshold} /><span>{Number(threshold).toFixed(2)}</span></label>
    <button class="lens-toggle" class:enabled={showLens} aria-pressed={showLens} onclick={() => { showLens = !showLens; if (focus) lensCenter = focus; }}>Detail lens {showLens ? 'on' : 'off'}</button>
    <div class="legend"><span><i class="semantic"></i>Semantic</span><span><i class="explicit"></i>Explicit</span><span><i class="blank"></i>No displayed link</span></div>
  </div>
  <div class="body">
    <div class="matrix-panel">
      <div class="matrix-topline"><span>{order === 'topics' ? 'Same topic → diagonal blocks' : 'Axis colors preserve topic membership'}</span><span>{query ? `${matching.size} matching notes · ${dimmedCount} dimmed` : 'All notes fit in this overview'}</span></div>
      <div class="plot">
        <svg bind:this={svg} viewBox="-120 -100 1000 990" role="grid" tabindex="0" aria-label={`Whole vault relationship matrix. ${nodes.length} rows and columns. Arrow keys move between cells, Enter collects the pair, Space toggles the row note, Escape unpins inspection.`} onpointermove={move} onclick={cellClick} onkeydown={keyboard}>
          <defs><pattern id="atlas-prototype-matrix-grid" width={step} height={step} patternUnits="userSpaceOnUse"><path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke="var(--border)" stroke-width="0.35" /></pattern></defs>
          <rect width={size} height={size} fill="var(--background)" stroke="var(--border)" stroke-width="1.5" />
          <rect width={size} height={size} fill="url(#atlas-prototype-matrix-grid)" pointer-events="none" />
          {#each bands as band, index (index)}
            <rect x={band.start * step} y="-17" width={band.count * step} height="9" fill={band.color} opacity="0.8" />
            <rect x="-17" y={band.start * step} width="9" height={band.count * step} fill={band.color} opacity="0.8" />
            {#if order === 'topics'}
              <path d={`M ${band.start * step} 0 V ${size} M 0 ${band.start * step} H ${size}`} stroke="var(--muted-foreground)" stroke-opacity="0.3" stroke-width="1.4" pointer-events="none" />
              <text transform={`translate(${(band.start + band.count / 2) * step}, -52) rotate(-25)`} font-size="13" text-anchor="middle" fill="var(--muted-foreground)">{band.label}</text>
            {/if}
          {/each}
          {#each cells as cell, index (index)}
            {@const x = cell.column * step}{@const y = cell.row * step}
            <g opacity={matching.has(nodes[cell.row].id) || matching.has(nodes[cell.column].id) ? 1 : 0.12} pointer-events="none">
              {#if cell.semantic !== null && cell.wikilink !== null}
                <path d={`M ${x} ${y} h ${step} v ${step} Z`} fill="#c15d25" fill-opacity={0.3 + cell.wikilink * 0.7} />
                <path d={`M ${x} ${y} v ${step} h ${step} Z`} fill="#178984" fill-opacity={0.3 + cell.semantic * 0.7} />
              {:else}
                <rect {x} {y} width={step} height={step} fill={cell.wikilink !== null ? '#c15d25' : '#178984'} fill-opacity={0.3 + (cell.wikilink ?? cell.semantic ?? 0) * 0.7} />
              {/if}
            </g>
          {/each}
          {#each nodes as node, index (node.id)}
            <rect x={index * step} y={index * step} width={step} height={step} fill="var(--muted-foreground)" opacity="0.12" pointer-events="none" />
            <g role="button" tabindex="-1" aria-label={`Toggle collection of ${node.title}`} onclick={(event) => { event.stopPropagation(); onToggle(node.id); inspect(index, index); pinned = true; }} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); event.preventDefault(); onToggle(node.id); } }}>
              <title>{node.title} · {topic(node)}</title>
              <rect data-row-node-id={node.id} x="-36" y={index * step} width="16" height={step} fill={selected.has(node.id) ? 'var(--primary)' : topicFor.get(node.id)?.color ?? 'var(--muted-foreground)'} opacity={matching.has(node.id) ? 0.85 : 0.15} />
              <rect data-column-node-id={node.id} x={index * step} y="-36" width={step} height="16" fill={selected.has(node.id) ? 'var(--primary)' : topicFor.get(node.id)?.color ?? 'var(--muted-foreground)'} opacity={matching.has(node.id) ? 0.85 : 0.15} />
            </g>
            {#if selected.has(node.id)}<rect x="0" y={index * step} width={size} height={step} fill="none" stroke="var(--primary)" stroke-opacity="0.55" stroke-width="1" pointer-events="none" /><rect x={index * step} y="0" width={step} height={size} fill="none" stroke="var(--primary)" stroke-opacity="0.55" stroke-width="1" pointer-events="none" />{/if}
            {#if !matching.has(node.id)}<rect x="0" y={index * step} width={size} height={step} fill="var(--background)" fill-opacity="0.55" pointer-events="none" /><rect x={index * step} y="0" width={step} height={size} fill="var(--background)" fill-opacity="0.55" pointer-events="none" />{/if}
          {/each}
          {#if focus && rowNode && columnNode}
            <rect x="0" y={focus.row * step} width={size} height={step} fill="var(--primary)" fill-opacity="0.08" stroke="var(--foreground)" stroke-opacity="0.35" stroke-width="1" pointer-events="none" />
            <rect x={focus.column * step} y="0" width={step} height={size} fill="var(--primary)" fill-opacity="0.08" stroke="var(--foreground)" stroke-opacity="0.35" stroke-width="1" pointer-events="none" />
            <rect x={focus.column * step} y={focus.row * step} width={step} height={step} fill="none" stroke="var(--foreground)" stroke-width="2.5" pointer-events="none" />
            <text x="-46" y={focus.row * step + step / 2} text-anchor="end" dominant-baseline="middle" font-size="13" fill="var(--foreground)" pointer-events="none">{focus.row + 1}</text>
            <text x={focus.column * step + step / 2} y="-42" text-anchor="middle" font-size="13" fill="var(--foreground)" pointer-events="none">{focus.column + 1}</text>
          {/if}
          {#if showLens && lensCount}<rect class="lens-boundary" x={lensStart.column * step} y={lensStart.row * step} width={lensCount * step} height={lensCount * step} fill="none" stroke="var(--foreground)" stroke-width="2" stroke-dasharray="5 3" pointer-events="none" />{/if}
          <text x={size / 2} y="837" text-anchor="middle" font-size="13" fill="var(--muted-foreground)" pointer-events="none">Columns = notes · rows = the same notes in the same order</text>
          <text x="-72" y={size / 2} text-anchor="middle" transform={`rotate(-90 -72 ${size / 2})`} font-size="13" fill="var(--muted-foreground)" pointer-events="none">Rows · hover to read exact sources</text>
          {#if !nodes.length}<text x="400" y="400" font-size="20" text-anchor="middle" fill="var(--muted-foreground)">No notes in this snapshot</text>{/if}
        </svg>
      </div>
      <footer><span>Hover a cell to inspect. Click to collect its pair. Axis markers toggle individual notes.</span><span>Keyboard: arrows · Enter collect · Space toggle row</span></footer>
    </div>
    <aside class="inspector">
      {#if showLens && lensCount}
        <div class="detail-lens">
          <div class="lens-heading"><strong>{lensCount} × {lensCount} detail lens</strong><span>Overview remains fitted</span></div>
          <div class="lens-grid" style={`grid-template-columns: 24px repeat(${lensCount}, minmax(0, 1fr))`} role="group" aria-label="Magnified matrix neighborhood. Hover a cell to inspect its exact notes; click to collect the pair.">
            <span class="axis-corner">r/c</span>
            {#each lensColumns as node, index (node.id)}<button class="lens-axis" title={node.title} aria-label={`Collect column ${lensStart.column + index + 1}: ${node.title}`} onclick={() => { onToggle(node.id); inspect(lensStart.column + index, lensStart.column + index, false); pinned = true; }}>{lensStart.column + index + 1}</button>{/each}
            {#each lensRows as row, ri (row.id)}
              <button class="lens-axis" title={row.title} aria-label={`Collect row ${lensStart.row + ri + 1}: ${row.title}`} onclick={() => { onToggle(row.id); inspect(lensStart.row + ri, lensStart.row + ri, false); pinned = true; }}>{lensStart.row + ri + 1}</button>
              {#each lensColumns as column, ci (column.id)}
                <button class="lens-cell" class:inspected={focus?.row === lensStart.row + ri && focus?.column === lensStart.column + ci} style={`background:${lensColor(row, column)};opacity:${matching.has(row.id) || matching.has(column.id) ? 1 : 0.25}`} title={`${row.title} × ${column.title}`} aria-label={`Inspect and collect ${row.title}${row.id === column.id ? '' : ` and ${column.title}`}`} onpointerenter={() => { if (!pinned) inspect(lensStart.row + ri, lensStart.column + ci, false); }} onfocus={() => inspect(lensStart.row + ri, lensStart.column + ci, false)} onclick={() => { inspect(lensStart.row + ri, lensStart.column + ci, false); cellClick(); }}></button>
              {/each}
            {/each}
          </div>
          <p>Hover the overview to position this lens. Hover its larger cells to inspect; click to collect. Unpin to resume following the pointer.</p>
        </div>
      {/if}
      <div class="inspection-heading"><span class="eyebrow">{pinned ? 'Pinned cell' : 'Cell inspection'}</span>{#if pinned}<button onclick={() => pinned = false}>Unpin</button>{/if}</div>
      {#if rowNode && columnNode}
        <div class="source"><span>ROW {focus!.row + 1} · {topic(rowNode)}</span><button class="source-title" onclick={() => onPreview(rowNode)}>{rowNode.title} ↗</button><p>{rowNode.preview || rowNode.notePath}</p><button class="toggle" onclick={() => onToggle(rowNode.id)}>{selected.has(rowNode.id) ? 'Remove from set' : 'Collect row note'}</button></div>
        {#if rowNode.id !== columnNode.id}<div class="source"><span>COLUMN {focus!.column + 1} · {topic(columnNode)}</span><button class="source-title" onclick={() => onPreview(columnNode)}>{columnNode.title} ↗</button><p>{columnNode.preview || columnNode.notePath}</p><button class="toggle" onclick={() => onToggle(columnNode.id)}>{selected.has(columnNode.id) ? 'Remove from set' : 'Collect column note'}</button></div>{/if}
        <div class="relationship">
          {#if rowNode.id === columnNode.id}<strong>Same note</strong><p>The diagonal is a reference line, not a self-relationship.</p>
          {:else if focusLinks.length}<strong>{shownLinks.length ? 'Recorded relationship' : 'Hidden by current filters'}</strong>{#each focusLinks as link (link.id)}<div class="score"><span class:explicit-label={link.kind === 'wikilink'}>{link.kind === 'wikilink' ? 'Explicit wikilink' : 'Semantic similarity'}</span><b>{link.strength.toFixed(2)}</b><small>Strength {link.strength.toFixed(2)} · score {link.score.toFixed(2)}{link.kind === 'wikilink' ? ` · ${link.sourceId === rowNode.id ? 'row → column' : 'column → row'}` : ''}</small></div>{/each}<p>Cells encode relationship strength. Similarity does not establish meaning or agreement.</p>
          {:else}<strong>No recorded link</strong><p>Blank means this snapshot contains no direct link between these notes. It does not prove they are unrelated.</p>{/if}
        </div>
        {#if rowNode.id !== columnNode.id}<button class="collect-pair" onclick={() => onAddMany([rowNode.id, columnNode.id])}>Collect both notes</button>{/if}
      {:else}<div class="instruction"><span class="matrix-symbol">▦</span><h2>Read the vault as a pattern</h2><p>Topic blocks group related notes along the diagonal. Colored cells away from these blocks show recorded connections across regions.</p><p>Hover any cell, including a blank one, to read its exact row and column titles.</p><p>Click a cell to collect both notes and pin their details. Arrow keys inspect fine cells without zooming.</p></div>{/if}
      <div class="honesty"><strong>What this view claims</strong><p>{nodes.length} notes appear on each axis, including notes without links. The matrix mirrors recorded links in both directions. Split cells contain both link kinds. Search dims notes without moving them.</p></div>
    </aside>
  </div>
</section>

<style>
  .matrix-workspace { height:100%; min-height:0; display:flex; flex-direction:column; color:var(--foreground); padding:7px 12px 0; }
  header { display:flex; justify-content:space-between; align-items:center; gap:18px; padding-bottom:15px; } .eyebrow { font-size:10px; letter-spacing:.16em; text-transform:uppercase; font-weight:650; color:var(--muted-foreground); } h1 { margin:5px 0; font-size:26px; letter-spacing:-.05em; font-weight:650; } header p { margin:0; font-size:12px; color:var(--muted-foreground); } .coverage { display:flex; flex-direction:column; align-items:flex-end; gap:4px; white-space:nowrap; }.coverage strong { font-size:19px; font-variant-numeric:tabular-nums; }.coverage span { font-size:10px; color:var(--muted-foreground); }
  .controls { display:flex; align-items:center; gap:18px; flex-wrap:wrap; padding:10px 0 14px; border-top:1px solid var(--border); font-size:11px; }.controls label { display:flex; align-items:center; gap:7px; color:var(--muted-foreground); } select { background:var(--background); color:var(--foreground); border:1px solid var(--border); border-radius:5px; padding:5px 8px; font-size:11px; } .threshold input { width:80px; accent-color:var(--primary); }.threshold span { width:28px; font-variant-numeric:tabular-nums; }.legend { display:flex; gap:12px; margin-left:auto; color:var(--muted-foreground); }.legend span { display:flex; align-items:center; gap:5px; }.legend i { width:9px; height:9px; display:inline-block; }.semantic { background:#178984; }.explicit { background:#c15d25; }.blank { border:1px solid var(--border); }
  .body { min-height:0; flex:1; display:grid; grid-template-columns:minmax(0,1fr) 270px; border:1px solid var(--border); border-radius:10px; overflow:hidden; }.matrix-panel { display:flex; flex-direction:column; min-height:0; min-width:0; background:color-mix(in srgb,var(--muted) 28%,var(--background)); }.matrix-topline { padding:12px 16px 0; display:flex; justify-content:space-between; gap:12px; font-size:10px; color:var(--muted-foreground); }.plot { flex:1; min-height:0; min-width:0; } svg { display:block; width:100%; height:100%; cursor:crosshair; } svg:focus-visible { outline:2px solid var(--ring); outline-offset:-3px; } footer { display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px; padding:8px 14px; font-size:9px; color:var(--muted-foreground); border-top:1px solid var(--border); }
  .inspector { border-left:1px solid var(--border); padding:18px; overflow:auto; background:var(--background); }.inspection-heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; } button { cursor:pointer; font:inherit; color:inherit; } .inspection-heading button { border:1px solid var(--border); border-radius:4px; padding:4px 7px; font-size:10px; background:var(--background); }.source { padding-bottom:15px; margin-bottom:15px; border-bottom:1px solid var(--border); }.source>span { display:block; font-size:9px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted-foreground); }.source-title { text-align:left; font-size:14px; font-weight:600; line-height:1.4; padding:0; background:transparent; border:0; margin-top:8px; }.source-title:hover { text-decoration:underline; }.source p { font-size:11px; line-height:1.6; color:var(--muted-foreground); margin:8px 0; display:-webkit-box; -webkit-line-clamp:3; line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }.toggle { border:1px solid var(--border); background:var(--background); border-radius:4px; font-size:10px; padding:5px 8px; }.toggle:hover,.inspection-heading button:hover { background:var(--muted); }
  .relationship strong { font-size:12px; font-weight:600; }.relationship p,.honesty p { font-size:10px; color:var(--muted-foreground); line-height:1.6; margin:8px 0; }.score { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:5px; margin-top:10px; font-size:10px; }.score span { color:#178984; }.score .explicit-label { color:#c15d25; }.score small { display:block; width:100%; font-size:9px; color:var(--muted-foreground); line-height:1.6; }.score b { font-variant-numeric:tabular-nums; font-size:12px; }.collect-pair { width:100%; padding:9px; background:var(--primary); color:var(--primary-foreground); border:0; border-radius:5px; font-size:11px; margin-top:14px; }.instruction h2 { font-size:15px; margin:12px 0; letter-spacing:-.025em; font-weight:600; }.instruction p { font-size:11px; line-height:1.7; color:var(--muted-foreground); }.matrix-symbol { display:block; font-size:44px; color:var(--muted-foreground); }.honesty { margin-top:24px; padding-top:14px; border-top:1px solid var(--border); }.honesty strong { font-size:10px; font-weight:600; }
  @media(max-width:1000px) { .body { grid-template-columns:minmax(0,1fr) 235px; }.inspector { padding:14px; }.legend { margin-left:0; }.controls { gap:10px; }.matrix-workspace { padding:12px 12px 0; } }
  @media(max-width:700px) { header p { max-width:400px; line-height:1.5; } h1 { font-size:21px; }.coverage { display:none; }.body { grid-template-columns:minmax(0,1fr) 190px; }.inspector { padding:10px; }.matrix-topline { display:none; }.legend { gap:7px; }.controls { font-size:10px; gap:7px; } }
  @media(max-width:500px) { .body { display:flex; flex-direction:column; }.matrix-panel { flex:1; min-height:240px; }.inspector { border-left:0; border-top:1px solid var(--border); max-height:180px; flex-shrink:0; }.instruction .matrix-symbol { display:none; }.instruction h2 { margin:2px 0 5px; }.honesty { display:none; } header { padding-bottom:9px; }.controls { padding:7px 0; }.threshold input { width:50px; }.legend { font-size:9px; } }
  header .eyebrow{display:none} h1{font-size:17px;margin:0 0 3px} header{padding-bottom:8px} header p{font-size:10px} .coverage strong{font-size:17px} .controls{padding:6px 0 8px}
  .lens-toggle { background:var(--background); border:1px solid var(--border); border-radius:5px; font-size:10px; padding:5px 8px; } .lens-toggle.enabled { background:var(--primary); color:var(--primary-foreground); }
  .detail-lens { border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:14px; }.lens-heading { display:flex; flex-direction:column; gap:3px; margin-bottom:8px; }.lens-heading strong { font-size:11px; font-weight:600; }.lens-heading span { font-size:9px; color:var(--muted-foreground); }.lens-grid { display:grid; gap:2px; }.axis-corner { display:grid; place-items:center; font-size:8px; color:var(--muted-foreground); }.lens-axis { border:0; background:var(--muted); color:var(--muted-foreground); font-size:8px; padding:2px 0; min-height:20px; }.lens-cell { display:block; aspect-ratio:1; min-height:18px; border:1px solid var(--border); padding:0; border-radius:1px; }.lens-cell.inspected { outline:2px solid var(--foreground); outline-offset:-2px; }.lens-cell:focus-visible,.lens-axis:focus-visible { outline:2px solid var(--ring); outline-offset:1px; }.detail-lens p { font-size:9px; line-height:1.5; color:var(--muted-foreground); margin:8px 0 0; }
</style>
