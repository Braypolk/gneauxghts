<script lang="ts">
  // E: Gaussian density and interpolated contours over existing Atlas coordinates, not new clusters.
  import type { AtlasNode } from '$lib/types/atlas';
  import { matchesQuery, type PrototypeProps } from './types';
  let { response, selectedIds, query, onToggle, onAddMany, onPreview }: PrototypeProps = $props();
  type Point = { x: number; y: number };
  type Sample = Point & { value: number };
  let smoothing = $state(34);
  let showFill = $state(true);
  let showTopics = $state(true);
  let linkKind = $state<'both' | 'wikilink' | 'semantic'>('both');
  let strength = $state(0.65);
  let zoom = $state(1);
  let brushMode = $state(false);
  let brushStart = $state<Point | null>(null);
  let brushEnd = $state<Point | null>(null);
  let hoveredId = $state<string | null>(null);
  let inspectedId = $state<string | null>(null);
  let svgElement: SVGSVGElement;
  const colors = ['#edf4ed', '#dbead8', '#c5debd', '#a5cca0', '#79af88', '#508d78', '#327466', '#1e5c55'];
  const topicColors = ['#759fa8', '#bb8caf', '#c2a366', '#7e9c71', '#a689c4', '#ca8587', '#6c9e97'];
  const GRID_W = 116, GRID_H = 64, STEP_X = 1000 / (GRID_W - 1), STEP_Y = 550 / (GRID_H - 1);
  let geometry = $derived.by(() => {
    const valid = response.nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
    const xs = valid.map((node) => node.x), ys = valid.map((node) => node.y);
    const minX = valid.length ? Math.min(...xs) : 0, maxX = valid.length ? Math.max(...xs) : 0;
    const minY = valid.length ? Math.min(...ys) : 0, maxY = valid.length ? Math.max(...ys) : 0;
    const scale = Math.min(860 / Math.max(1, maxX - minX), 410 / Math.max(1, maxY - minY));
    const project = (x: number, y: number) => ({ x: 500 + (x - (minX + maxX) / 2) * scale, y: 268 + (y - (minY + maxY) / 2) * scale });
    const roots = response.clouds.filter((cloud) => !cloud.parentId);
    const marks = response.nodes.map((node, index) => {
      const topicIndex = roots.findIndex((cloud) => cloud.memberNodeIds.includes(node.id) || [node.cloudId, node.parentCloudId].includes(cloud.id));
      const positioned = Number.isFinite(node.x) && Number.isFinite(node.y);
      return { node, ...positioned ? project(node.x, node.y) : { x: 25 + index * 9 % 950, y: 523 }, positioned,
        color: topicIndex < 0 ? '#91959b' : topicColors[topicIndex % topicColors.length] };
    });
    const placed: { x: number; y: number; width: number; height: number }[] = [];
    const topics = roots.filter((cloud) => cloud.memberNodeIds.some((id) => marks.some((mark) => mark.node.id === id))).map((cloud) => {
      const anchor = project(cloud.centroid[0], cloud.centroid[1]);
      const label = cloud.label || 'Unlabelled topic';
      const width = Math.min(180, label.length * 7.2 + 14), height = 20;
      let candidate = { x: Math.max(16, Math.min(980 - width, anchor.x - width / 2)), y: Math.max(20, Math.min(480, anchor.y - 24)), width, height };
      for (let attempt = 0; attempt < 28; attempt++) {
        const angle = attempt * 2.4, radius = 20 + Math.floor(attempt / 5) * 16;
        const option = { x: Math.max(16, Math.min(980 - width, anchor.x + Math.cos(angle) * radius - width / 2)), y: Math.max(20, Math.min(480, anchor.y + Math.sin(angle) * radius - 10)), width, height };
        candidate = option;
        if (!placed.some((box) => option.x < box.x + box.width + 5 && option.x + width + 5 > box.x && option.y < box.y + box.height + 5 && option.y + height + 5 > box.y)) break;
      }
      placed.push(candidate);
      return { id: cloud.id, label, anchor, ...candidate };
    });
    return { marks, topics, project };
  });
  let byId = $derived(new Map(geometry.marks.map((mark) => [mark.node.id, mark])));
  const interpolate = (a: Sample, b: Sample, level: number): Point => {
    const weight = (level - a.value) / (b.value - a.value);
    return { x: a.x + (b.x - a.x) * weight, y: a.y + (b.y - a.y) * weight };
  };
  const coordinates = (point: Point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  let terrain = $derived.by(() => {
    const values = new Float64Array(GRID_W * GRID_H);
    const sigma = Number(smoothing), cutoff = sigma * 3.5;
    for (const mark of geometry.marks) {
      if (!mark.positioned) continue;
      const left = Math.max(0, Math.floor((mark.x - cutoff) / STEP_X)), right = Math.min(GRID_W - 1, Math.ceil((mark.x + cutoff) / STEP_X));
      const top = Math.max(0, Math.floor((mark.y - cutoff) / STEP_Y)), bottom = Math.min(GRID_H - 1, Math.ceil((mark.y + cutoff) / STEP_Y));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const distance = (x * STEP_X - mark.x) ** 2 + (y * STEP_Y - mark.y) ** 2;
        values[y * GRID_W + x] += Math.exp(-distance / (2 * sigma * sigma));
      }
    }
    const maximum = Math.max(...values);
    if (!maximum) return [];
    const levels = [0.035, 0.09, 0.17, 0.28, 0.42, 0.59, 0.77, 0.94].map((fraction) => fraction * maximum);
    // Linear interpolation on grid triangles yields both filled superlevel polygons and actual isolines.
    const bands = levels.map((level, index) => ({ level, color: colors[index], fill: [] as string[], line: [] as string[] }));
    const vertex = (x: number, y: number): Sample => ({ x: x * STEP_X, y: y * STEP_Y, value: values[y * GRID_W + x] });
    for (let y = 0; y < GRID_H - 1; y++) for (let x = 0; x < GRID_W - 1; x++) {
      const a = vertex(x, y), b = vertex(x + 1, y), c = vertex(x + 1, y + 1), d = vertex(x, y + 1);
      for (const triangle of [[a, b, c], [a, c, d]]) for (const band of bands) {
        const polygon: Point[] = [], crossings: Point[] = [];
        for (let i = 0; i < 3; i++) {
          const current = triangle[i], previous = triangle[(i + 2) % 3];
          if ((current.value >= band.level) !== (previous.value >= band.level)) {
            const crossing = interpolate(previous, current, band.level); polygon.push(crossing); crossings.push(crossing);
          }
          if (current.value >= band.level) polygon.push(current);
        }
        if (polygon.length >= 3) band.fill.push(`M${polygon.map(coordinates).join('L')}Z`);
        if (crossings.length === 2) band.line.push(`M${coordinates(crossings[0])}L${coordinates(crossings[1])}`);
      }
    }
    return bands.map((band) => ({ level: band.level, color: band.color, fill: band.fill.join(''), line: band.line.join('') }));
  });
  let focusId = $derived(hoveredId ?? inspectedId);
  let focused = $derived(byId.get(focusId ?? ''));
  let eligible = $derived(response.links.filter((link) => byId.has(link.sourceId) && byId.has(link.targetId)
    && (linkKind === 'both' || link.kind === linkKind) && link.strength >= Number(strength)));
  let focusedLinks = $derived(eligible.filter((link) => focusId ? link.sourceId === focusId || link.targetId === focusId : selectedIds.includes(link.sourceId) || selectedIds.includes(link.targetId)));
  let lens = $derived(focused ? geometry.marks.filter((mark) => Math.hypot(mark.x - focused.x, mark.y - focused.y) * zoom < 17).sort((a, b) => Math.hypot(a.x - focused!.x, a.y - focused!.y) - Math.hypot(b.x - focused!.x, b.y - focused!.y)) : []);
  let brushBounds = $derived(brushStart && brushEnd ? { x: Math.min(brushStart.x, brushEnd.x), y: Math.min(brushStart.y, brushEnd.y), width: Math.abs(brushEnd.x - brushStart.x), height: Math.abs(brushEnd.y - brushStart.y) } : null);
  let brushed = $derived(brushBounds ? geometry.marks.filter((mark) => mark.x >= brushBounds!.x && mark.x <= brushBounds!.x + brushBounds!.width && mark.y >= brushBounds!.y && mark.y <= brushBounds!.y + brushBounds!.height) : []);
  let searchMatches = $derived(response.nodes.filter((node) => matchesQuery(node, query)).length);
  function eventPoint(event: PointerEvent): Point | null {
    const matrix = svgElement?.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: 500 + (screen.x - 500) / zoom, y: 275 + (screen.y - 275) / zoom };
  }
  function startBrush(event: PointerEvent) {
    if (!brushMode || event.button !== 0) return;
    brushStart = eventPoint(event); brushEnd = brushStart;
    svgElement.setPointerCapture(event.pointerId);
  }
  function moveBrush(event: PointerEvent) { if (brushStart) brushEnd = eventPoint(event); }
  function endBrush(event: PointerEvent) {
    if (!brushStart) return;
    brushEnd = eventPoint(event);
    if (brushed.length) onAddMany(brushed.map((mark) => mark.node.id));
    brushStart = null; brushEnd = null;
    if (svgElement.hasPointerCapture(event.pointerId)) svgElement.releasePointerCapture(event.pointerId);
  }
  function inspect(node: AtlasNode) { inspectedId = node.id; onToggle(node.id); }
</script>

<section class="landscape" aria-label="Contour landscape whole-vault visualization">
  <header><div><span class="eyebrow">E / Contour landscape</span><h1>The shape of your thinking.</h1><p>Continuous note concentration over your existing Atlas positions.</p></div><span class="coverage">{geometry.marks.length} / {response.nodes.length} notes</span></header>
  <div class="controls">
    <label>Smoothing <input type="range" min="14" max="76" step="2" bind:value={smoothing} aria-label="Terrain smoothing"/><output>{smoothing}</output></label>
    <label><input type="checkbox" bind:checked={showFill}/>Filled terrain</label><label><input type="checkbox" bind:checked={showTopics}/>Topic labels</label>
    <label>Links <select bind:value={linkKind} aria-label="Terrain link type"><option value="both">Both kinds</option><option value="wikilink">Explicit</option><option value="semantic">Similar</option></select></label>
    <label>Min <input class="short" type="range" min="0" max="1" step="0.05" bind:value={strength} aria-label="Terrain connection strength"/><output>{Number(strength).toFixed(2)}</output></label>
    <button class:active={brushMode} onclick={() => { brushMode = !brushMode; brushStart = null; brushEnd = null; }} aria-pressed={brushMode}>▧ Select rectangle</button>
    <div class="zoom"><button onclick={() => zoom = Math.max(1, zoom / 1.4)} aria-label="Zoom out terrain">−</button><span>{zoom.toFixed(1)}×</span><button onclick={() => zoom = Math.min(5.4, zoom * 1.4)} aria-label="Zoom in terrain">+</button><button onclick={() => { zoom = 1; brushStart = null; brushEnd = null; }}>Reset</button></div>
  </div>
  <div class="plot">
    <svg bind:this={svgElement} viewBox="0 0 1000 550" class:brush-mode={brushMode} role="img" aria-label={`Contour landscape with all ${geometry.marks.length} notes`} onpointerdown={startBrush} onpointermove={moveBrush} onpointerup={endBrush} onpointercancel={() => { brushStart = null; brushEnd = null; }}>
      <title>Gaussian density terrain. Contour shapes show note concentration, not topic membership.</title>
      <defs><clipPath id="contour-landscape-plot"><rect width="1000" height="550"/></clipPath></defs>
      <g clip-path="url(#contour-landscape-plot)">
        <g transform={`translate(500 275) scale(${zoom}) translate(-500 -275)`}>
          <rect width="1000" height="550" fill="var(--color-background)"/>
          <g class="terrain">
            {#each terrain as band, index}<path d={band.fill} fill={showFill ? band.color : 'none'} opacity={showFill ? 0.88 : 0}/><path d={band.line} fill="none" stroke={showFill ? '#426d60' : 'var(--color-muted-foreground)'} stroke-width={(index % 2 === 0 ? 0.8 : 0.45) / zoom} opacity={showFill ? 0.5 : 0.35}/>{/each}
          </g>
          <g class="links">{#each focusedLinks as link (link.id)}{@const a = byId.get(link.sourceId)!}{@const b = byId.get(link.targetId)!}<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={link.kind === 'wikilink' ? '#283f42' : '#754e87'} stroke-width={1.5 / zoom} stroke-dasharray={link.kind === 'semantic' ? `${4 / zoom} ${3 / zoom}` : 'none'} opacity="0.8"/>{/each}</g>
          {#each geometry.marks as mark (mark.node.id)}
            {@const collected = selectedIds.includes(mark.node.id)}{@const match = matchesQuery(mark.node, query)}
            <g role="button" tabindex="0" data-node-id={mark.node.id} aria-label={`${mark.node.title || mark.node.fileName}${collected ? ', collected' : ''}. Collect and inspect`}
              onmouseenter={() => hoveredId = mark.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = mark.node.id} onblur={() => hoveredId = null}
              onclick={() => { if (!brushMode) inspect(mark.node); }} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(mark.node); } }} opacity={match ? 1 : 0.18}>
              <title>{mark.node.title || mark.node.fileName}{mark.positioned ? '' : ' · position unavailable'}</title>
              {#if collected || focusId === mark.node.id}<circle cx={mark.x} cy={mark.y} r={7 / zoom} fill="var(--color-background)" stroke={collected ? '#192b33' : '#6b4c85'} stroke-width={1.7 / zoom}/>{/if}
              <circle cx={mark.x} cy={mark.y} r={3.7 / Math.sqrt(zoom)} fill={collected ? '#192b33' : mark.color} stroke="var(--color-background)" stroke-width={0.9 / zoom}/>
              <circle cx={mark.x} cy={mark.y} r={7 / zoom} fill="transparent"/>
            </g>
          {/each}
          {#if showTopics}<g class="topic-labels">{#each geometry.topics as topic (topic.id)}<line x1={topic.anchor.x} y1={topic.anchor.y} x2={topic.x + topic.width / 2} y2={topic.y + 10} stroke="#476762" stroke-width={0.6 / zoom} opacity="0.5"/><rect x={topic.x} y={topic.y} width={topic.width} height={topic.height} rx="4" fill="var(--color-background)" opacity="0.85"/><text x={topic.x + 7} y={topic.y + 14} font-size="13" fill="var(--color-foreground)"><title>{topic.label}</title>{topic.label.length > 23 ? `${topic.label.slice(0, 21)}…` : topic.label}</text>{/each}</g>{/if}
          {#if brushBounds}<rect x={brushBounds.x} y={brushBounds.y} width={brushBounds.width} height={brushBounds.height} fill="#697cbf22" stroke="#697cbf" stroke-width={1.3 / zoom} stroke-dasharray={`${4 / zoom} ${3 / zoom}`}/>{/if}
        </g>
      </g>
      {#if !response.nodes.length}<text x="500" y="275" text-anchor="middle" font-size="15" fill="var(--color-muted-foreground)">No notes in this snapshot.</text>{/if}
    </svg>
    {#if focused && !brushStart}
      <aside class="inspector" aria-label="Terrain note inspector"><div class="inspector-top"><span>{hoveredId ? 'Under the pointer' : 'Focused note'}</span><button onclick={() => inspectedId = null} aria-label="Clear terrain focus">×</button></div><h2>{focused.node.title || focused.node.fileName}</h2><p class="excerpt">{focused.node.preview || 'No source excerpt available.'}</p><p class="connections-count">{focusedLinks.length} connections pass the link filters</p><div class="link-reasons">{#each focusedLinks.slice(0, 2) as link}<span title={byId.get(link.sourceId === focusId ? link.targetId : link.sourceId)?.node.title}>{link.kind === 'wikilink' ? 'Explicit link' : 'Semantic match'} · {link.strength.toFixed(2)} · {byId.get(link.sourceId === focusId ? link.targetId : link.sourceId)?.node.title || 'Note'}</span>{/each}</div><div class="actions"><button onclick={() => onPreview(focused!.node)}>Read source</button><button onclick={() => onToggle(focused!.node.id)}>{selectedIds.includes(focused.node.id) ? '✓ Collected' : '+ Collect'}</button></div>
        {#if lens.length > 1}<div class="local-lens"><span>{lens.length} notes overlap nearby — choose one</span>{#each lens.slice(0, 6) as mark}<button class:current={mark.node.id === focused.node.id} onclick={() => { hoveredId = null; inspectedId = mark.node.id; }}>{mark.node.title || mark.node.fileName}</button>{/each}{#if lens.length > 6}<small>Zoom in to separate {lens.length - 6} more.</small>{/if}</div>{/if}
      </aside>
    {/if}
    <div class="plot-hint">{brushStart ? `${brushed.length} notes inside · release to collect` : brushMode ? 'Drag a rectangle to collect all notes inside.' : 'Hover to trace links · click to collect · zoom to separate nearby notes'}<small>Solid = explicit link · dashed = semantic match</small></div>
    <div class="legend"><span>Sparse</span><i style:background={`linear-gradient(to right,${colors.join(',')})`}></i><span>Dense</span><b>relative concentration</b></div>
  </div>
  <footer><span>Density = note concentration. Contours do not define semantic groups.</span><span>{query.trim() ? `${searchMatches} matches; terrain and all note positions stay fixed.` : `${geometry.topics.length} topic anchors · ${selectedIds.length} collected · links appear on focus`}</span></footer>
</section>

<style>
  .landscape{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--color-foreground)} header{padding:7px 12px 8px;display:flex;justify-content:space-between;align-items:center;gap:12px}.eyebrow{display:none}h1{font-size:17px;letter-spacing:-.025em;font-weight:620;margin:0 0 3px}header p{font-size:10px;color:var(--color-muted-foreground);margin:0}.coverage{font-size:10px;white-space:nowrap;border:1px solid var(--color-border);border-radius:20px;padding:6px 10px}
  .controls{display:flex;align-items:center;flex-wrap:wrap;gap:11px;padding:6px 12px;border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);font-size:10px;color:var(--color-muted-foreground)}.controls label{display:flex;align-items:center;gap:5px}.controls input[type=range]{width:70px;accent-color:#508d78}.controls input.short{width:45px}.controls input[type=checkbox]{accent-color:#508d78}output{min-width:24px}select{font-size:10px;padding:4px;background:var(--color-background);color:var(--color-foreground);border:1px solid var(--color-border);border-radius:4px}button{cursor:pointer}.controls button,.actions button{border:1px solid var(--color-border);border-radius:5px;padding:5px 7px;color:var(--color-foreground);background:var(--color-background);font-size:10px}.controls button.active{background:var(--color-foreground);color:var(--color-background)}.zoom{display:flex;align-items:center;gap:5px;margin-left:auto}.zoom button{padding:3px 6px}.zoom span{font-size:9px}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--color-ring);outline-offset:2px}
  .plot{position:relative;flex:1;min-height:240px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--color-background)}svg{width:100%;height:100%;max-height:100%;user-select:none;touch-action:none}.terrain,.links,.topic-labels{pointer-events:none}svg g[role=button]{cursor:pointer;outline:none}svg g[role=button]:focus-visible>circle{stroke:var(--color-foreground);stroke-width:2px}.brush-mode,.brush-mode g[role=button]{cursor:crosshair!important}
  .inspector{position:absolute;top:12px;right:12px;width:226px;max-height:calc(100% - 52px);overflow:auto;background:color-mix(in srgb,var(--color-background) 97%,transparent);border:1px solid var(--color-border);border-radius:9px;padding:12px;box-shadow:0 4px 18px #00000012}.inspector-top{display:flex;justify-content:space-between;align-items:center;font-size:9px;color:var(--color-muted-foreground)}.inspector-top button{font-size:15px;line-height:1}.inspector h2{font-size:13px;font-weight:600;line-height:1.45;margin:7px 0;overflow-wrap:anywhere}.excerpt{font-size:10px;line-height:1.7;color:var(--color-muted-foreground);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden;margin:6px 0}.connections-count{font-size:9px;color:var(--color-muted-foreground);margin:7px 0}.actions{display:flex;gap:5px;flex-wrap:wrap}.local-lens{border-top:1px solid var(--color-border);margin-top:10px;padding-top:8px;display:grid;gap:3px}.local-lens>span{font-size:8px;color:var(--color-muted-foreground);line-height:1.5;margin-bottom:3px}.local-lens button{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:9px;padding:4px;border-radius:3px}.local-lens button:hover,.local-lens .current{background:var(--color-muted)}.local-lens small{font-size:8px;color:var(--color-muted-foreground)}
  .plot-hint{position:absolute;bottom:10px;left:12px;max-width:70%;background:color-mix(in srgb,var(--color-background) 85%,transparent);padding:4px 7px;border-radius:4px;font-size:9px;color:var(--color-muted-foreground);pointer-events:none}.legend{position:absolute;bottom:12px;right:12px;display:flex;align-items:center;gap:6px;font-size:9px;color:var(--color-muted-foreground);pointer-events:none}.legend i{width:80px;height:7px;border-radius:3px}.legend b{font-size:8px;font-weight:400;margin-left:4px}footer{display:flex;justify-content:space-between;gap:5px 12px;flex-wrap:wrap;padding:5px 12px;font-size:9px;color:var(--color-muted-foreground)}
  .plot-hint small{display:block;font-size:8px;margin-top:3px}.link-reasons{display:grid;gap:3px;margin:6px 0 9px;font-size:8px;color:var(--color-muted-foreground)}.link-reasons span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:900px){.controls{gap:7px}.controls input[type=range]{width:55px}.legend b{display:none}.inspector{width:190px;right:8px;top:8px}.plot-hint{font-size:8px;max-width:60%}.zoom{margin-left:0}}@media(max-width:560px){header p,.coverage{display:none}.controls{font-size:9px}.inspector{width:164px;padding:9px}.excerpt{display:none}.legend{font-size:8px}.legend i{width:50px}.plot-hint{bottom:30px;max-width:85%}footer{font-size:8px}}
</style>
