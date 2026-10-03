<script lang="ts">
  // V3: original Atlas geometry + an anchored reader, connection glide, and honest opening activity.
  import { onMount } from 'svelte';
  import type { AtlasNode, AtlasLink } from '$lib/types/atlas';
  import { matchesQuery, daysAgo, type PrototypeProps } from './types';
  type Activity = { counts: Record<string, number>; countAvailable: boolean; notice: string };
  type Props = PrototypeProps & { activity?: Activity; readSource?: (node: AtlasNode) => Promise<string> };
  type Point = { x: number; y: number };
  let { response, selectedIds, query, onToggle, onAddMany, onPreview, activity, readSource }: Props = $props();
  let kind = $state<'both' | 'wikilink' | 'semantic'>('both');
  let threshold = $state(0);
  let allLinks = $state(false);
  let activityMode = $state<'recency' | 'frequency'>('recency');
  let scope = $state<'all' | 'search' | 'topic' | 'connected'>('all');
  let activeId = $state<string | null>(null);
  let browseOriginId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let anchor = $state<Point | null>(null);
  let zoom = $state(1), panX = $state(0), panY = $state(0);
  let showChildren = $state(false);
  let plotElement = $state<HTMLDivElement | null>(null);
  let svgElement: SVGSVGElement;
  let width = $state(1000), height = $state(560);
  let drag = $state<{ id: number; x: number; y: number; originalX: number; originalY: number } | null>(null);
  let fullText = $state<string | null>(null);
  let readStatus = $state<'idle' | 'loading' | 'error'>('idle');
  let readSequence = 0, wheelTime = 0;
  let lastQuery = $state('');
  let lastSearchDataset = $state('');
  const palette = ['#6a9fac', '#aa8cbd', '#ad9a69', '#7f9c7d', '#b58895', '#879aca'];
  let geometry = $derived.by(() => {
    const coordinates = [...response.nodes.map((node) => [node.x, node.y]), ...response.clouds.flatMap((cloud) => cloud.hull)]
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const minX = coordinates.length ? Math.min(...coordinates.map(([x]) => x)) : 0;
    const maxX = coordinates.length ? Math.max(...coordinates.map(([x]) => x)) : 1;
    const minY = coordinates.length ? Math.min(...coordinates.map(([, y]) => y)) : 0;
    const maxY = coordinates.length ? Math.max(...coordinates.map(([, y]) => y)) : 1;
    const scale = Math.min(Math.max(1, width - 64) / Math.max(1, maxX - minX), Math.max(1, height - 88) / Math.max(1, maxY - minY));
    const project = (x: number, y: number): Point => ({ x: width / 2 + (x - (minX + maxX) / 2) * scale, y: height / 2 + (y - (minY + maxY) / 2) * scale });
    const roots = response.clouds.filter((cloud) => !cloud.parentId);
    const clouds = response.clouds.map((cloud, i) => ({ cloud, color: `rgb(${cloud.color.slice(0, 3).join(' ')})`,
      points: cloud.hull.map(([x, y]) => project(x, y)), center: project(cloud.centroid[0], cloud.centroid[1]), fallback: palette[i % palette.length] }));
    const nodes = response.nodes.map((node) => {
      const root = roots.find((cloud) => [node.parentCloudId, node.cloudId].includes(cloud.id) || cloud.memberNodeIds.includes(node.id));
      const cloud = clouds.find((item) => item.cloud.id === (node.childCloudId ?? node.cloudId ?? node.parentCloudId));
      return { node, ...project(node.x, node.y), rootId: root?.id ?? null, color: cloud?.color ?? '#959da6' };
    });
    return { nodes, clouds, project };
  });
  let byId = $derived(new Map(geometry.nodes.map((mark) => [mark.node.id, mark])));
  let cloudById = $derived(new Map(geometry.clouds.map((item) => [item.cloud.id, item])));
  let active = $derived(byId.get(activeId ?? ''));
  let hovered = $derived(byId.get(hoveredId ?? ''));
  let origin = $derived(byId.get(browseOriginId ?? activeId ?? ''));
  let matching = $derived(response.nodes.filter((node) => matchesQuery(node, query)));
  let eligibleLinks = $derived(response.links.filter((link) => byId.has(link.sourceId) && byId.has(link.targetId)
    && (kind === 'both' || link.kind === kind) && link.strength >= Number(threshold)));
  let originConnections = $derived(new Set(eligibleLinks.filter((link) => link.sourceId === origin?.node.id || link.targetId === origin?.node.id).flatMap((link) => [link.sourceId, link.targetId])));
  let pool = $derived(scope === 'search' ? matching : scope === 'topic' ? response.nodes.filter((node) => byId.get(node.id)?.rootId === origin?.rootId)
    : scope === 'connected' ? response.nodes.filter((node) => originConnections.has(node.id)) : response.nodes);
  let poolIndex = $derived(pool.findIndex((node) => node.id === activeId));
  let focusId = $derived(hoveredId ?? activeId);
  let incident = $derived(eligibleLinks.filter((link) => link.sourceId === focusId || link.targetId === focusId).sort((a, b) => b.strength - a.strength));
  let incidentIds = $derived(new Set(incident.map((link) => link.id)));
  let relatedNodeIds = $derived(new Set(incident.flatMap((link) => [link.sourceId, link.targetId])));
  let topIds = $derived.by(() => {
    const result = new Set<string>();
    const perNode = new Map<string, AtlasLink[]>();
    for (const link of eligibleLinks) for (const id of [link.sourceId, link.targetId]) perNode.set(id, [...(perNode.get(id) ?? []), link]);
    for (const links of perNode.values()) links.sort((a, b) => b.strength - a.strength).slice(0, 2).forEach((link) => result.add(link.id));
    return result;
  });
  let links = $derived(eligibleLinks.filter((link) => allLinks || topIds.has(link.id) || incidentIds.has(link.id)));
  const screen = (point: Point): Point => ({ x: width / 2 + (point.x - width / 2) * zoom + panX, y: height / 2 + (point.y - height / 2) * zoom + panY });
  const pixels = (point: Point): Point => point;
  let cardPosition = $derived.by(() => {
    const point = pixels(anchor ?? { x: width / 2, y: height / 2 });
    const cardWidth = Math.min(width < 600 ? 228 : 268, Math.max(186, width - 26));
    const cardHeight = Math.min(width < 600 ? 320 : 282, height - 28);
    const left = { x: point.x - cardWidth - 18, y: point.y - 36 }, right = { x: point.x + 18, y: point.y - 36 };
    const choices = [
      ...(point.x < width / 2 ? [left, right] : [right, left]),
      { x: point.x - cardWidth / 2, y: point.y + 18 },
      { x: point.x - cardWidth / 2, y: point.y - cardHeight - 18 }
    ].map((choice) => ({ x: Math.max(12, Math.min(width - cardWidth - 12, choice.x)), y: Math.max(12, Math.min(height - cardHeight - 12, choice.y)) }));
    const avoidsPoint = (choice: Point) => point.x < choice.x - 8 || point.x > choice.x + cardWidth + 8 || point.y < choice.y - 8 || point.y > choice.y + cardHeight + 8;
    const chosen = choices.find(avoidsPoint) ?? choices[0];
    return { ...chosen, width: cardWidth, height: cardHeight };

  });
  let hoverPosition = $derived.by(() => {
    const point = hovered ? pixels(screen(hovered)) : { x: 0, y: 0 };
    return { x: Math.max(8, Math.min(width - 216, point.x + 13)), y: Math.max(8, Math.min(height - 88, point.y - 25)) };
  });
  let callouts = $derived.by(() => {
    const focus = byId.get(focusId ?? '');
    if (!focus) return [];
    const candidates = [focus, ...incident.slice(0, 4).map((link) => byId.get(link.sourceId === focusId ? link.targetId : link.sourceId)!)];
    const used = new Set<string>();
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    return candidates.filter((mark) => { if (used.has(mark.node.id)) return false; used.add(mark.node.id); return true; }).map((mark) => {
      const point = screen(mark), text = mark.node.title || mark.node.fileName;
      const textWidth = Math.min(208, Math.max(80, text.length * 7.8));
      let box = { x: point.x + 11, y: point.y - 19, width: textWidth, height: 22 };
      for (let i = 0; i < 10; i++) {
        const option = { x: Math.max(10, Math.min(width - 10 - textWidth, point.x + (i % 2 ? -textWidth - 11 : 11))), y: Math.max(10, Math.min(height - 30, point.y - 25 + Math.floor(i / 2) * 25)), width: textWidth, height: 22 };
        box = option;
        if (!boxes.some((other) => option.x < other.x + other.width + 5 && option.x + option.width + 5 > other.x && option.y < other.y + other.height + 3 && option.y + option.height + 3 > other.y)) break;
      }
      boxes.push(box);
      return { ...box, point, node: mark.node, focused: mark.node.id === focusId };
    });
  });
  let topicLabels = $derived.by(() => {
    const boxes = callouts.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height }));
    return geometry.clouds.filter((item) => !item.cloud.parentId || showChildren && zoom > 1.4)
      .sort((a, b) => b.cloud.noteCount - a.cloud.noteCount).map((item) => {
        const point = screen(item.center), label = (item.cloud.label || 'Unlabelled region').slice(0, 24);
        const textWidth = Math.min(178, Math.max(70, label.length * 7.1));
        let box = { x: point.x - textWidth / 2, y: point.y - 25, width: textWidth, height: 21 };
        for (let i = 0; i < 24; i++) {
          const angle = i * 2.4, radius = 18 + Math.floor(i / 5) * 18;
          const option = { x: Math.max(7, Math.min(width - textWidth - 7, point.x + Math.cos(angle) * radius - textWidth / 2)), y: Math.max(8, Math.min(height - 35, point.y + Math.sin(angle) * radius - 10)), width: textWidth, height: 21 };
          box = option;
          if (!boxes.some((other) => option.x < other.x + other.width + 3 && option.x + textWidth + 3 > other.x && option.y < other.y + other.height + 3 && option.y + 24 > other.y)) break;
        }
        boxes.push(box);
        return { item, point, label, ...box };
      });
  });
  function usage(node: AtlasNode): number | null {
    const value = activity?.counts[node.id];
    return activity?.countAvailable && typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
  }
  function activityColor(node: AtlasNode) {
    if (activityMode === 'frequency' && activity?.countAvailable) {
      const count = usage(node);
      return count === null ? '#979da5' : count >= 2 ? '#4f74ac' : count > 0 ? '#83a4b3' : '#bd9a61';
    }
    if (!node.lastViewedAtMillis) return '#bd9654';
    const days = Math.max(0, (Date.now() - node.lastViewedAtMillis) / 86400000);
    return days <= 7 ? '#5c89b0' : days <= 30 ? '#7aa4ad' : days <= 90 ? '#a4b4b5' : '#98a5ae';
  }
  function activityText(node: AtlasNode) {
    const last = node.lastViewedAtMillis ? `Last opened ${daysAgo(node.lastViewedAtMillis).toLowerCase()}` : 'No recorded opening';
    const weight = usage(node);
    if (activityMode === 'frequency' && activity?.countAvailable && weight === null && !node.lastViewedAtMillis) return 'No recorded opening';
    return activityMode === 'frequency' && activity?.countAvailable ? `${weight === null ? 'Activity weight unavailable' : `Activity weight ${weight.toFixed(1)}`} · ${last}` : last;
  }
  function excerptText(text: string) {
    // Keep link labels readable in the small preview; the full source retains exact Markdown.
    return text.replace(/\[([^\]\n]+)\]\((?:https?:\/\/|\/)[^)\s]+\)/g, '$1');
  }
  function bundle(link: AtlasLink) {
    const a = byId.get(link.sourceId)!, b = byId.get(link.targetId)!;
    const rootA = cloudById.get(a.rootId ?? '')?.center ?? a, rootB = cloudById.get(b.rootId ?? '')?.center ?? b;
    if (a.rootId && a.rootId === b.rootId) return `M${a.x},${a.y}Q${rootA.x},${rootA.y} ${b.x},${b.y}`;
    return `M${a.x},${a.y}C${rootA.x},${rootA.y} ${rootB.x},${rootB.y} ${b.x},${b.y}`;
  }
  function changeActive(node: AtlasNode, placeAnchor: boolean) {
    activeId = node.id; fullText = null; readStatus = 'idle'; readSequence++;
    if (placeAnchor || !anchor) { anchor = screen(byId.get(node.id)!); browseOriginId = node.id; }
  }
  function pin(node: AtlasNode) { changeActive(node, true); }
  function cycle(direction: number) {
    if (!pool.length) return;
    const index = poolIndex < 0 ? (direction > 0 ? -1 : 0) : poolIndex;
    changeActive(pool[(index + direction + pool.length) % pool.length], false);
  }
  function wheelCard(event: WheelEvent) {
    if ((event.target as HTMLElement).closest('.full-source')) return;
    event.preventDefault(); event.stopPropagation();
    if (performance.now() - wheelTime < 135 || Math.abs(event.deltaY) < 3) return;
    wheelTime = performance.now(); cycle(event.deltaY > 0 ? 1 : -1);
  }
  function keyBrowse(event: KeyboardEvent) {
    const element = event.target as HTMLElement;
    if (!active || !plotElement?.contains(element) || element.closest('input,textarea,select,.full-source,[contenteditable="true"]') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); cycle(event.key === 'ArrowDown' ? 1 : -1);
  }
  async function loadSource() {
    if (!active || !readSource) return;
    const id = active.node.id, sequence = ++readSequence;
    readStatus = 'loading';
    try { const text = await readSource(active.node); if (sequence === readSequence && activeId === id) { fullText = text; readStatus = 'idle'; } }
    catch { if (sequence === readSequence && activeId === id) readStatus = 'error'; }
  }
  function closeCard() { activeId = null; anchor = null; fullText = null; readStatus = 'idle'; readSequence++; }
  function canvasPoint(event: PointerEvent | WheelEvent): Point {
    const matrix = svgElement.getScreenCTM();
    if (!matrix) return { x: width / 2, y: height / 2 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  function startPan(event: PointerEvent) {
    if (event.button !== 0 || (event.target as Element).closest('[data-node-id]')) return;
    const point = canvasPoint(event); drag = { id: event.pointerId, ...point, originalX: panX, originalY: panY };
    svgElement.setPointerCapture(event.pointerId);
  }
  function movePan(event: PointerEvent) { if (!drag) return; const point = canvasPoint(event); panX = drag.originalX + point.x - drag.x; panY = drag.originalY + point.y - drag.y; }
  function stopPan(event: PointerEvent) { drag = null; if (svgElement.hasPointerCapture(event.pointerId)) svgElement.releasePointerCapture(event.pointerId); }
  function zoomAt(event: WheelEvent) {
    event.preventDefault(); const point = canvasPoint(event), next = Math.max(0.7, Math.min(5, zoom * (event.deltaY < 0 ? 1.13 : 1 / 1.13)));
    const ratio = next / zoom; panX = point.x - width / 2 - (point.x - width / 2 - panX) * ratio; panY = point.y - height / 2 - (point.y - height / 2 - panY) * ratio; zoom = next;
  }
  function reset() { zoom = 1; panX = 0; panY = 0; }
  $effect(() => {
    const text = query.trim();
    const dataset = `${response.structuralGeneration}:${response.revision}:${response.nodes.length}`;
    if (lastQuery === text && lastSearchDataset === dataset) return;
    lastQuery = text;
    lastSearchDataset = dataset;
    if (!text) return;
    scope = 'search';
    const first = response.nodes.find((node) => matchesQuery(node, text));
    if (first) { changeActive(first, !anchor); browseOriginId = first.id; } else closeCard();
  });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) { if (anchor) anchor = { x: anchor.x * entry.contentRect.width / width, y: anchor.y * entry.contentRect.height / height }; width = entry.contentRect.width; height = entry.contentRect.height; } });
    if (plotElement) observer.observe(plotElement);
    return () => observer.disconnect();
  });
</script>

<svelte:window onkeydown={keyBrowse}/>
<section class="fusion" aria-label="Atlas fusion hybrid visualization">
  <header><div><h1>Atlas, with your notes within reach.</h1><p>Original map geometry · read at the point of focus · glide through connected ideas</p></div><span>{response.nodes.length} notes{query.trim() ? ` · ${matching.length} matches` : ''}</span></header>
  <div class="controls">
    <label>Connections <select bind:value={kind} aria-label="Fusion connection type"><option value="both">Linked + similar</option><option value="wikilink">Explicit links</option><option value="semantic">Semantic matches</option></select></label>
    <label>Strength <input type="range" min="0" max="1" step="0.05" bind:value={threshold} aria-label="Fusion connection strength"/><output>{Number(threshold).toFixed(2)}</output></label>
    <label><input type="checkbox" bind:checked={allLinks}/>All links</label>
    <label>Activity <select bind:value={activityMode} aria-label="Fusion activity encoding"><option value="recency">Last opened</option>{#if activity?.countAvailable}<option value="frequency">Opening activity</option>{/if}</select></label>
    <label><input type="checkbox" bind:checked={showChildren}/>Subtopics</label>
    <div class="map-controls"><button onclick={() => zoom = Math.max(0.7, zoom / 1.3)} aria-label="Fusion zoom out">−</button><span>{zoom.toFixed(1)}×</span><button onclick={() => zoom = Math.min(5, zoom * 1.3)} aria-label="Fusion zoom in">+</button><button onclick={reset}>Reset view</button></div>
  </div>
  <div class="plot" bind:this={plotElement}>
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Original Atlas geometry with all ${response.nodes.length} notes`} onpointerdown={startPan} onpointermove={movePan} onpointerup={stopPan} onpointercancel={stopPan} onwheel={zoomAt}>
      <title>Original Atlas coordinates and topic hulls with an anchored note preview.</title>
      <defs><clipPath id="atlas-fusion-clip"><rect width={width} height={height}/></clipPath></defs>
      <g clip-path="url(#atlas-fusion-clip)">
        <g transform={`translate(${width / 2 + panX} ${height / 2 + panY}) scale(${zoom}) translate(${-width / 2} ${-height / 2})`}>
          {#each geometry.clouds.filter((item) => !item.cloud.parentId || showChildren) as item (item.cloud.id)}
            <polygon points={item.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={item.color} fill-opacity={item.cloud.parentId ? 0.05 : 0.12} stroke={item.color} stroke-opacity={item.cloud.parentId ? 0.3 : 0.58} stroke-width={1 / zoom} stroke-dasharray={item.cloud.parentId ? `${3 / zoom} ${3 / zoom}` : 'none'}/>
          {/each}
          <g class="map-links">{#each links as link (link.id)}<path d={bundle(link)} fill="none" stroke={link.kind === 'wikilink' ? 'var(--color-foreground)' : '#967aa9'} stroke-width={(incidentIds.has(link.id) ? 1.8 : 0.65) / zoom} stroke-dasharray={link.kind === 'semantic' ? `${4 / zoom} ${3 / zoom}` : 'none'} opacity={focusId ? incidentIds.has(link.id) ? 0.8 : 0.035 : allLinks ? 0.11 : 0.075}/>{/each}</g>
          {#each geometry.nodes as mark (mark.node.id)}
            {@const collected = selectedIds.includes(mark.node.id)}{@const match = matchesQuery(mark.node, query)}
            <g role="button" tabindex="0" data-node-id={mark.node.id} aria-label={`${mark.node.title || mark.node.fileName}. Pin preview. ${activityText(mark.node)}`}
              onmouseenter={() => hoveredId = mark.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = mark.node.id} onblur={() => hoveredId = null}
              onclick={() => pin(mark.node)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pin(mark.node); } }} opacity={match ? 1 : relatedNodeIds.has(mark.node.id) ? 0.78 : 0.34}>
              <title>{mark.node.title || mark.node.fileName}</title>
              {#if collected}<circle cx={mark.x} cy={mark.y} r={8 / zoom} fill="none" stroke="var(--color-foreground)" stroke-width={1 / zoom}/>{/if}
              {#if focusId === mark.node.id}<circle cx={mark.x} cy={mark.y} r={10 / zoom} fill="none" stroke="#6f87b6" stroke-width={1.7 / zoom}/>{/if}
              <circle cx={mark.x} cy={mark.y} r={5.8 / Math.sqrt(zoom)} fill="none" stroke={activityColor(mark.node)} stroke-width={1.3 / zoom} opacity="0.9"/>
              <circle cx={mark.x} cy={mark.y} r={3 / Math.sqrt(zoom)} fill={mark.color} stroke="var(--color-background)" stroke-width={0.6 / zoom}/>
              <circle cx={mark.x} cy={mark.y} r={8 / zoom} fill="transparent"/>
            </g>
          {/each}
        </g>
        <g class="map-labels">{#each topicLabels as label (label.item.cloud.id)}<line x1={label.point.x} y1={label.point.y} x2={label.x + label.width / 2} y2={label.y + 10} stroke={label.item.color} stroke-width="0.6" opacity="0.45"/><text x={label.x + label.width / 2} y={label.y + 15} text-anchor="middle" font-size={label.item.cloud.parentId ? 11 : 13} font-weight="550" fill="var(--color-muted-foreground)" stroke="var(--color-background)" stroke-width="3.5" paint-order="stroke">{label.label}</text>{/each}</g>
        {#if active && anchor}{@const activePoint = screen(active)}<line x1={activePoint.x} y1={activePoint.y} x2={anchor.x} y2={anchor.y} stroke="#748fba" stroke-width="1" stroke-dasharray="3 3" opacity="0.4"/>{/if}
        <g class="callouts">{#each callouts as item (item.node.id)}<line x1={item.point.x} y1={item.point.y} x2={item.x + item.width / 2} y2={item.y + 9} stroke={item.focused ? '#6f87b6' : 'var(--color-muted-foreground)'} stroke-width="0.7" opacity="0.65"/><rect x={item.x} y={item.y} width={item.width} height="22" rx="3" fill="var(--color-background)" opacity="0.93"/><text x={item.x + 5} y={item.y + 15} font-size="13" font-weight={item.focused ? '650' : '450'} fill="var(--color-foreground)">{(item.node.title || item.node.fileName).slice(0, 27)}</text>{/each}</g>
      </g>
      {#if !response.nodes.length}<text x={width / 2} y={height / 2} text-anchor="middle" fill="var(--color-muted-foreground)">No notes in this snapshot.</text>{/if}
    </svg>
    {#if hovered && hoveredId !== activeId}
      <div class="hover-preview" style:left={`${hoverPosition.x}px`} style:top={`${hoverPosition.y}px`}><strong>{hovered.node.title || hovered.node.fileName}</strong><p>{excerptText(hovered.node.preview) || 'No excerpt available.'}</p><span>{activityText(hovered.node)} · click to pin</span></div>
    {/if}
    {#if active && anchor}
      <div class="anchor-dot" style:left={`${pixels(anchor).x}px`} style:top={`${pixels(anchor).y}px`}></div>
      <article class="reader" style:left={`${cardPosition.x}px`} style:top={`${cardPosition.y}px`} style:width={`${cardPosition.width}px`} style:height={`${cardPosition.height}px`} onwheel={wheelCard} aria-label="Anchored note preview">
        <div class="reader-heading"><span>Pinned here · wheel to glide</span><button onclick={closeCard} aria-label="Close anchored preview">×</button></div>
        <h2>{active.node.title || active.node.fileName}</h2><p class="activity-detail">{activityText(active.node)}</p>
        <div class="browse"><label>Browse <select bind:value={scope} onchange={() => { if (active) browseOriginId = active.node.id; }} aria-label="Fusion browsing pool"><option value="all">All notes</option><option value="search">Search matches</option><option value="topic">This topic</option><option value="connected">Connected notes</option></select></label><div><button disabled={!pool.length} onclick={() => cycle(-1)} aria-label="Previous Atlas note">↑</button><span>{poolIndex >= 0 ? poolIndex + 1 : '–'} / {pool.length}</span><button disabled={!pool.length} onclick={() => cycle(1)} aria-label="Next Atlas note">↓</button></div></div>
        {#if fullText !== null}<div class="full-source" tabindex="0" role="textbox" aria-readonly="true" aria-label="Full note source">{fullText}</div>{:else}<div class="reader-excerpt">{excerptText(active.node.preview) || 'No excerpt available for this note.'}</div>{/if}
        <div class="reader-footer"><span>{eligibleLinks.filter((link) => link.sourceId === active.node.id || link.targetId === active.node.id).length} eligible connections</span><div><button onclick={() => onToggle(active!.node.id)}>{selectedIds.includes(active.node.id) ? '✓ Collected' : '+ Collect'}</button>{#if readSource}<button disabled={readStatus === 'loading'} onclick={loadSource}>{readStatus === 'loading' ? 'Loading…' : fullText !== null ? 'Reload source' : 'Read full source'}</button>{:else}<button onclick={() => onPreview(active!.node)}>Read source</button>{/if}</div>{#if readStatus === 'error'}<small>Could not load this source. Try again.</small>{/if}{#if !pool.length}<small>This browsing pool has no notes. Choose another scope.</small>{/if}</div>
      </article>
    {/if}
    <div class="legend"><span><i class="amber"></i>{activityMode === 'frequency' ? 'Low / idle activity' : 'No recorded opening'}</span>{#if activityMode === 'frequency' && activity?.countAvailable}<span><i class="unknown"></i>No recorded opening</span><span><i class="cool"></i>Higher activity weight</span>{:else}<span><i class="cool"></i>Recently opened</span>{/if}<span>Solid: explicit · dashed: similar</span></div>
    <div class="map-tip">{query.trim() && !matching.length ? 'No search matches. All vault notes remain on the map.' : active ? '↑ ↓ or wheel over the card to browse. Drag the map to pan.' : 'Hover to read a glimpse. Click a note to pin its preview.'}</div>
  </div>
  <footer><span>{activityMode === 'frequency' && activity?.countAvailable ? 'Activity weight decays with idle time; it is not a lifetime open count.' : 'Opening recency is separate from semantic importance.'}</span><span title={activity?.notice}>{activity?.notice || 'Opening activity counts unavailable; showing recorded recency.'}</span></footer>
</section>

<style>
  .fusion{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--color-foreground);outline:none}header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 12px 8px}h1{font-size:16px;font-weight:620;letter-spacing:-.025em;margin:0 0 3px}header p{font-size:10px;color:var(--color-muted-foreground);margin:0}header>span{font-size:10px;white-space:nowrap;color:var(--color-muted-foreground)}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:11px;padding:6px 12px;border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);font-size:10px;color:var(--color-muted-foreground)}.controls label{display:flex;align-items:center;gap:5px}.controls input[type=range]{width:65px;accent-color:#829fae}.controls input[type=checkbox]{accent-color:#829fae}output{width:23px}select{font-size:10px;background:var(--color-background);color:var(--color-foreground);border:1px solid var(--color-border);border-radius:4px;padding:4px}.map-controls{margin-left:auto;display:flex;align-items:center;gap:5px}.map-controls button{border:1px solid var(--color-border);padding:3px 6px;border-radius:4px;color:var(--color-foreground)}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible,select:focus-visible,.reader:focus-visible,.full-source:focus-visible{outline:2px solid var(--color-ring);outline-offset:2px}.plot{position:relative;flex:1;min-height:250px;overflow:hidden;background:var(--color-background)}svg{width:100%;height:100%;max-height:100%;touch-action:none;user-select:none;cursor:grab}svg:active{cursor:grabbing}svg g[role=button]{cursor:pointer;outline:none}svg g[role=button]:focus-visible>circle{stroke:var(--color-foreground);stroke-width:2px}.map-links,.map-labels,.callouts{pointer-events:none}
  .hover-preview{position:absolute;width:208px;max-height:88px;overflow:hidden;pointer-events:none;z-index:4;background:color-mix(in srgb,var(--color-background) 97%,transparent);border:1px solid var(--color-border);border-radius:6px;padding:8px;box-shadow:0 4px 13px #00000012}.hover-preview strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:600}.hover-preview p{font-size:9px;line-height:1.5;color:var(--color-muted-foreground);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;margin:4px 0}.hover-preview>span{font-size:8px;color:var(--color-muted-foreground)}.anchor-dot{position:absolute;transform:translate(-50%,-50%);width:9px;height:9px;border:2px solid #748fba;border-radius:50%;pointer-events:none;background:var(--color-background);z-index:2}
  .reader{position:absolute;z-index:3;display:flex;flex-direction:column;gap:0;overflow:hidden;padding:11px;background:color-mix(in srgb,var(--color-background) 98%,transparent);border:1px solid #7b8fae;border-radius:9px;box-shadow:0 7px 22px #00000018}.reader-heading{display:flex;align-items:center;justify-content:space-between;font-size:8px;color:var(--color-muted-foreground)}.reader-heading button{font-size:16px;line-height:1}.reader h2{font-size:13px;font-weight:620;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:6px 0 3px}.activity-detail{font-size:8px;color:var(--color-muted-foreground);margin:0 0 7px}.browse{display:flex;justify-content:space-between;align-items:center;gap:7px;border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);padding:6px 0;font-size:9px}.browse label,.browse>div{display:flex;gap:5px;align-items:center}.browse select{font-size:9px;padding:3px;max-width:114px}.browse button{font-size:12px;border:1px solid var(--color-border);border-radius:3px;width:20px;height:20px}.browse>div>span{font-size:8px;white-space:nowrap}.reader-excerpt,.full-source{flex:1;min-height:0;overflow:auto;margin:8px 0;font-size:11px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.reader-excerpt{overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;line-clamp:5}.full-source{font-size:10px;padding-right:3px;overscroll-behavior:contain}.reader-footer{border-top:1px solid var(--color-border);padding-top:7px;font-size:8px;color:var(--color-muted-foreground)}.reader-footer>div{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}.reader-footer button{padding:4px 6px;border:1px solid var(--color-border);border-radius:4px;font-size:9px;color:var(--color-foreground)}.reader-footer small{display:block;margin-top:4px;font-size:8px}
  .reader-heading,.reader h2,.activity-detail,.browse,.reader-footer{flex-shrink:0}
  .legend{position:absolute;bottom:10px;left:12px;display:flex;flex-wrap:wrap;gap:10px;font-size:8px;color:var(--color-muted-foreground);pointer-events:none;background:color-mix(in srgb,var(--color-background) 80%,transparent);padding:4px 5px;border-radius:4px}.legend span{display:flex;gap:4px;align-items:center}.legend i{display:inline-block;border:1.5px solid;border-radius:50%;width:8px;height:8px}.legend .amber{border-color:#bd9654}.legend .cool{border-color:#5c89b0}.legend .unknown{border-color:#979da5}.map-tip{position:absolute;top:8px;left:12px;max-width:65%;font-size:9px;color:var(--color-muted-foreground);background:color-mix(in srgb,var(--color-background) 85%,transparent);padding:4px 6px;border-radius:4px;pointer-events:none}footer{display:flex;gap:5px 15px;justify-content:space-between;padding:5px 12px;font-size:8px;color:var(--color-muted-foreground)}footer>span:last-child{max-width:50%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:850px){.controls{gap:7px}.controls input[type=range]{width:45px}.map-controls{margin-left:0}header p{font-size:9px}.legend{gap:6px}.map-tip{font-size:8px}.reader{padding:9px}footer>span:last-child{max-width:45%}}@media(max-width:560px){header p,header>span{display:none}.reader .activity-detail{display:block;font-size:8px;line-height:1.2;margin:0 0 4px}.reader h2{margin:4px 0}.reader .browse{padding:4px 0}.reader .reader-footer>span{display:none}.reader .reader-footer{padding-top:4px}.reader .reader-footer>div{margin-top:0}.reader .reader-excerpt{margin:5px 0;font-size:10px}.controls{font-size:9px;padding:5px 8px}.controls select{font-size:9px}.controls input[type=range]{width:40px}.legend span:last-child{display:none}.map-tip{max-width:85%}footer>span:last-child{display:none}}
</style>
