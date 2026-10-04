<script lang="ts">
  // V3 experiment: topic geography with spaced dots and zoom-faded plain names, inspired by Obsidian.
  import { onMount, type Snippet } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  import type { AtlasNode, AtlasLink, VaultAtlasResponse } from '$lib/types/atlas';
  import { daysAgo } from './atlasActivity';
  import { createAtlasLayout, noteTitle, labelWorldSize, type Point } from './atlasLayout';
  type Props = {
    response: VaultAtlasResponse;
    query: string;
    selectedNodeId: string | null;
    selectNode: (node: AtlasNode | null) => void;
    matchingIds: ReadonlySet<string>;
    openNode: (node: AtlasNode) => Promise<void>;
    readSource: (node: AtlasNode) => Promise<string>;
    search: Snippet<[() => void]>;
  };
  let { response, query, selectedNodeId, selectNode, matchingIds, openNode, readSource, search }: Props = $props();
  let inspectedRegionId = $state<string | null>(null);
  let workbenchElement = $state<HTMLDivElement | null>(null);
  let activeId = $derived(selectedNodeId);
  let browseOriginId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let zoom = $state(1), panX = $state(0), panY = $state(0);
  const labelZoom = 0.55;
  let panelOpen = $state(false);
  let plotElement = $state<HTMLDivElement | null>(null);
  let svgElement: SVGSVGElement;
  let width = $state(1000), height = $state(560);
  let drag = $state<{ id: number; x: number; y: number; originalX: number; originalY: number } | null>(null);
  let fullText = $state<string | null>(null);
  let readStatus = $state<'idle' | 'loading' | 'error'>('idle');
  let readSequence = 0, wheelTime = 0;
  let sourceSignature = '';
  let zoomFrame = 0, pendingZoomDelta = 0;
  let pendingZoomPoint: Point | null = null;
  let hasPlotSize = $state(false), hasFramed = false;
  let cameraCenter = $state<Point>({ x: 0, y: 0 });
  const layout = createAtlasLayout();
  let geometry = $derived(layout(response));
  let byId = $derived(new Map(geometry.nodes.map((mark) => [mark.node.id, mark])));
  let active = $derived(byId.get(activeId ?? ''));
  let hovered = $derived(byId.get(hoveredId ?? ''));
  let origin = $derived(byId.get(browseOriginId ?? activeId ?? ''));
  let matching = $derived([...matchingIds].map(id => byId.get(id)?.node).filter((node): node is AtlasNode => !!node));
  let eligibleLinks = $derived(response.links.filter((link) => byId.has(link.sourceId) && byId.has(link.targetId)));
  let originConnections = $derived(new Set([...(origin ? [origin.node.id] : []), ...eligibleLinks.filter((link) => link.sourceId === origin?.node.id || link.targetId === origin?.node.id).flatMap((link) => [link.sourceId, link.targetId])]));
  let pool = $derived(query.trim() ? matching : response.nodes.filter((node) => originConnections.has(node.id)));
  let poolIndex = $derived(pool.findIndex((node) => node.id === activeId));
  // A pinned note owns the neighborhood until closed or another note is chosen.
  let focusId = $derived(activeId ?? hoveredId);
  let incident = $derived(eligibleLinks.filter((link) => link.sourceId === focusId || link.targetId === focusId).sort((a, b) => b.strength - a.strength));
  let incidentIds = $derived(new Set(incident.map((link) => link.id)));
  let relatedNodeIds = $derived(new Set([...(focusId ? [focusId] : []), ...incident.flatMap((link) => [link.sourceId, link.targetId])]));
  // Quiet overview; exploring a note reveals its connections without a permanent web of edges.
  let links = $derived(incident);
  const tileTitle = noteTitle;
  // Spaced geography stays fixed; camera and label visibility never repack it.

  let graphClouds = $derived(geometry.clouds.filter(item => item.points.length));
  let worldBounds = $derived.by(() => {
    const points = graphClouds.flatMap((cloud) => cloud.points).concat(geometry.nodes);
    const minX = points.length ? Math.min(...points.map((point) => point.x)) : -100;
    const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 100;
    const minY = points.length ? Math.min(...points.map((point) => point.y)) : -100;
    const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 100;
    return { center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  });
  let fitScale = $derived(Math.min(Math.max(1, width - 48) / worldBounds.width, Math.max(1, height - 48) / worldBounds.height));
  let cameraScale = $derived(zoom);
  const screen = (point: Point): Point => ({ x: width / 2 + (point.x - cameraCenter.x) * cameraScale + panX, y: height / 2 + (point.y - cameraCenter.y) * cameraScale + panY });
  // Published Atlas centrality includes weighted explicit and similarity links.
  // Size expresses connectedness, independently of opening activity.
  const connectedness = (node: AtlasNode) => Number.isFinite(node.centrality) ? Math.max(0, Math.min(1, node.centrality)) : 0;
  const dotRadius = (id: string) => 3.25 + 3.25 * connectedness(byId.get(id)!.node);
  // Keep relative sizes visible at overview, then scale linearly with the map.
  const visibleRadius = (id: string) => Math.max(2 + 1.5 * connectedness(byId.get(id)!.node), dotRadius(id) * cameraScale);
  const activityNow = Date.now();
  function attention(node: AtlasNode) {
    const weight = usage(node);
    const hasTimestamp = typeof node.lastViewedAtMillis === 'number' && Number.isFinite(node.lastViewedAtMillis) && node.lastViewedAtMillis > 0;
    const recency = hasTimestamp ? Math.pow(2, -Math.max(0, activityNow - node.lastViewedAtMillis!) / (14 * 86400000)) : null;
    const frequency = weight === null ? null : Math.min(1, Math.log1p(weight) / Math.log(5));
    if (recency !== null && frequency !== null) return recency * 0.65 + frequency * 0.35;
    return recency ?? frequency ?? 0;
  }
  function dotOpacity(node: AtlasNode) {
    if (node.id === activeId || node.id === hoveredId) return 1;
    if (query.trim()) return matchingIds.has(node.id) ? 1 : activeId && relatedNodeIds.has(node.id) ? 0.85 : 0.18;
    if (activeId) return relatedNodeIds.has(node.id) ? 0.9 : 0.18;
    // Unknown or old activity remains clearly visible; it does not mean never read.
    return 0.6 + 0.3 * attention(node);
  }
  let labelSize = $derived(labelWorldSize * cameraScale);
  let labelOpacity = $derived.by(() => {
    const value = Math.max(0, Math.min(1, (cameraScale - Number(labelZoom) * 0.55) / (Number(labelZoom) * 0.65)));
    return value * value * (3 - 2 * value);
  });
  // Every eligible name remains mounted and follows the same zoom rate.
  // One shared fade replaces per-name collision and viewport visibility gates.
  let filenameLabels = $derived(geometry.nodes.filter((mark) => !activeId || relatedNodeIds.has(mark.node.id)).map((mark) => {
    const point = screen(mark);
    return { ...mark, title: tileTitle(mark.node), x: point.x,
      y: point.y + visibleRadius(mark.node.id) + (labelWorldSize + 3) * cameraScale,
      opacity: activeId ? 1 : labelOpacity };
  }));
  function dotConnection(link: AtlasLink) {
    const a = byId.get(link.sourceId)!, b = byId.get(link.targetId)!;
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
    if (distance < 0.001) return '';
    const start = Math.min(visibleRadius(a.node.id) / cameraScale, distance / 2), end = Math.min(visibleRadius(b.node.id) / cameraScale, distance / 2);
    return `M${a.x + dx / distance * start},${a.y + dy / distance * start}L${b.x - dx / distance * end},${b.y - dy / distance * end}`;
  }
  const regionName = (fallback: string | null) => fallback || 'Unlabelled region';
  let regions = $derived(geometry.clouds.filter((item) => !item.cloud.parentId).map((item) => ({
    ...item, name: regionName(item.cloud.label),
    examples: item.cloud.representativeNodeIds.map((id) => byId.get(id)?.node).filter((node): node is AtlasNode => !!node)
  })));
  let inspectedRegion = $derived(regions.find((item) => item.cloud.id === inspectedRegionId));
  function inspectRegion(id: string) {
    closeCard(); inspectedRegionId = id; panelOpen = true;
    const region = graphClouds.find((item) => item.cloud.id === id);
    if (!region) return;
    const x = (Math.min(...region.points.map((point) => point.x)) + Math.max(...region.points.map((point) => point.x))) / 2;
    const y = (Math.min(...region.points.map((point) => point.y)) + Math.max(...region.points.map((point) => point.y))) / 2;
    clearZoomQueue(); zoom = Math.max(0.75, Math.min(1.5, Math.min((width - 48) / Math.max(1, Math.max(...region.points.map((point) => point.x)) - Math.min(...region.points.map((point) => point.x))), (height - 48) / Math.max(1, Math.max(...region.points.map((point) => point.y)) - Math.min(...region.points.map((point) => point.y))))));
    panX = (cameraCenter.x - x) * zoom; panY = (cameraCenter.y - y) * zoom;
  }
  let hoverPosition = $derived.by(() => {
    const point = hovered ? screen(hovered) : { x: 0, y: 0 };
    const x = point.x + 224 <= width ? point.x + 12 : point.x - 224;
    return { x: Math.max(8, Math.min(width - 216, x)), y: Math.max(8, Math.min(height - 88, point.y - 100)) };
  });
  function usage(node: AtlasNode): number | null {
    const value = node.effectiveOpenCount;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
  }
  function activityText(node: AtlasNode) {
    const last = node.lastViewedAtMillis ? `Last opened ${daysAgo(node.lastViewedAtMillis).toLowerCase()}` : 'No recorded opening';
    const weight = usage(node);
    return weight === null ? last : `Activity weight ${weight.toFixed(1)} · ${last}`;
  }
  function excerptText(text: string) {
    // Keep link labels readable in the small preview; the full source retains exact Markdown.
    return text.replace(/\[([^\]\n]+)\]\((?:https?:\/\/|\/)[^)\s]+\)/g, '$1');
  }
  function changeActive(node: AtlasNode, startOrigin: boolean) {
    panelOpen = true; selectNode(node); fullText = null; readStatus = 'idle'; readSequence++;
    if (startOrigin || !browseOriginId) browseOriginId = node.id;
  }
  function clickNode(node: AtlasNode) { if (performance.now() >= ignoreClickUntil) pin(node); }
  function pin(node: AtlasNode) { changeActive(node, true); }
  function cycle(direction: number) {
    if (!pool.length) return;
    const index = poolIndex < 0 ? (direction > 0 ? -1 : 0) : poolIndex;
    changeActive(pool[(index + direction + pool.length) % pool.length], false);
  }
  function wheelCard(event: WheelEvent) {
    if ((event.target as HTMLElement).closest('.full-source')) { event.stopPropagation(); return; }
    event.preventDefault(); event.stopPropagation();
    if (performance.now() - wheelTime < 135 || Math.abs(event.deltaY) < 3) return;
    wheelTime = performance.now(); cycle(event.deltaY > 0 ? 1 : -1);
  }
  function keyBrowse(event: KeyboardEvent) {
    const element = event.target as HTMLElement;
    if (element.closest('input,textarea,select,.full-source,[contenteditable="true"]')) return;
    if (event.key === 'Escape') { closeCard(); return; }
    if (element !== document.body && !workbenchElement?.contains(element)) return;
    if (element.closest('button')) return;
    if (event.key === 'Enter' && active) { event.preventDefault(); void openNode(active.node); return; }
    if (event.key === '0') { event.preventDefault(); reset(); return; }
    if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); setZoomAt(zoom * Math.exp(event.key === '-' ? -0.2 : 0.2), { x: width / 2, y: height / 2 }); return; }
    if (active && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); cycle(event.key === 'ArrowDown' ? 1 : -1); }
  }
  async function loadSource() {
    if (!active || !readSource) return;
    const id = active.node.id, sequence = ++readSequence;
    readStatus = 'loading';
    try { const text = await readSource(active.node); if (sequence === readSequence && activeId === id) { fullText = text; readStatus = 'idle'; } }
    catch { if (sequence === readSequence && activeId === id) readStatus = 'error'; }
  }
  function closeCard() { panelOpen = false; hoveredId = null; selectNode(null); fullText = null; readStatus = 'idle'; readSequence++; }
  function canvasPoint(event: PointerEvent | WheelEvent): Point {
    const matrix = svgElement.getScreenCTM();
    if (!matrix) return { x: width / 2, y: height / 2 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  let gestureMoved = false, ignoreClickUntil = 0;
  const pointers = new Map<number, Point>();
  let pinch: { distance: number; midpoint: Point; zoom: number } | null = null;
  function measurePinch() {
    const [a, b] = [...pointers.values()];
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom };
  }
  function startPan(event: PointerEvent) {
    if (event.button !== 0 || (event.pointerType !== 'touch' && (event.target as Element).closest('[role="button"]'))) return;
    const point = canvasPoint(event); pointers.set(event.pointerId, point);
    if (pointers.size === 2) {
      for (const id of pointers.keys()) svgElement.setPointerCapture(id);
      gestureMoved = true; clearZoomQueue(); pinch = measurePinch(); drag = null;
    }
    else if (pointers.size === 1) { gestureMoved = false; drag = { id: event.pointerId, ...point, originalX: panX, originalY: panY }; }
  }
  function movePan(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const point = canvasPoint(event); pointers.set(event.pointerId, point);
    if (pointers.size >= 2 && pinch) {
      const next = measurePinch();
      setZoomAt(pinch.zoom * next.distance / pinch.distance, pinch.midpoint);
      panX += next.midpoint.x - pinch.midpoint.x; panY += next.midpoint.y - pinch.midpoint.y;
      pinch = { ...next, zoom };
    } else if (drag) {
      if (!gestureMoved && Math.hypot(point.x - drag.x, point.y - drag.y) < 4) return;
      gestureMoved = true; svgElement.setPointerCapture(event.pointerId);
      panX = drag.originalX + point.x - drag.x; panY = drag.originalY + point.y - drag.y; }
  }
  function stopPan(event: PointerEvent) {
    if (gestureMoved) ignoreClickUntil = performance.now() + 250;
    pointers.delete(event.pointerId); pinch = null; drag = null;
    if (pointers.size === 1) { const [id, point] = [...pointers.entries()][0]; drag = { id, ...point, originalX: panX, originalY: panY }; }
    if (svgElement.hasPointerCapture(event.pointerId)) svgElement.releasePointerCapture(event.pointerId);
  }
  function setZoomAt(next: number, point: Point) {
    next = Math.max(Math.min(0.04, fitScale * 0.5), Math.min(12, next));
    const ratio = next / zoom; panX = point.x - width / 2 - (point.x - width / 2 - panX) * ratio; panY = point.y - height / 2 - (point.y - height / 2 - panY) * ratio; zoom = next;
  }
  function clearZoomQueue() {
    if (zoomFrame) cancelAnimationFrame(zoomFrame);
    zoomFrame = 0; pendingZoomDelta = 0; pendingZoomPoint = null;
  }
  function zoomAt(event: WheelEvent) {
    event.preventDefault();
    if (!event.deltaY || !Number.isFinite(event.deltaY)) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    const pixels = Math.max(-100, Math.min(100, event.deltaY * unit));
    // Trackpads send many tiny pixel deltas. Scale by distance, not event count;
    // browsers represent pinch-to-zoom as small Ctrl+wheel deltas.
    pendingZoomDelta = Math.max(-0.15, Math.min(0.15, pendingZoomDelta - pixels * (event.ctrlKey ? 0.006 : 0.0012)));
    pendingZoomPoint = canvasPoint(event);
    if (zoomFrame) return;
    zoomFrame = requestAnimationFrame(() => {
      const delta = pendingZoomDelta, point = pendingZoomPoint;
      zoomFrame = 0; pendingZoomDelta = 0; pendingZoomPoint = null;
      if (point) setZoomAt(zoom * Math.exp(delta), point);
    });
  }
  function reset() { clearZoomQueue(); cameraCenter = worldBounds.center; zoom = fitScale; panX = 0; panY = 0; }
  $effect(() => {
    if (hasPlotSize && response.nodes.length && !hasFramed) { hasFramed = true; reset(); }
  });
  $effect(() => {
    const ids = new Set(response.nodes.map(node => node.id));
    if (browseOriginId && !ids.has(browseOriginId)) browseOriginId = null;
    if (hoveredId && !ids.has(hoveredId)) hoveredId = null;
    if (inspectedRegionId && !response.clouds.some(cloud => cloud.id === inspectedRegionId)) inspectedRegionId = null;
    // A refreshed excerpt/path invalidates the previously read source, including in-flight reads.
    const signature = active ? `${active.node.id}:${active.node.notePath}:${active.node.updatedAtMillis}:${active.node.preview}` : '';
    if (signature !== sourceSignature) { sourceSignature = signature; fullText = null; readStatus = 'idle'; readSequence++; if (active) panelOpen = true; }
  });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) { width = entry.contentRect.width; height = entry.contentRect.height; hasPlotSize = true; } });
    if (plotElement) observer.observe(plotElement);
    return () => { observer.disconnect(); clearZoomQueue(); };
  });
</script>

<svelte:window onkeydown={keyBrowse}/>
<section class="fusion" aria-label="Atlas fusion hybrid visualization">
  <div class="workbench" bind:this={workbenchElement}>
  <div class="plot" bind:this={plotElement}>
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Atlas dot map with all ${response.nodes.length} notes`} onpointerdown={startPan} onpointermove={movePan} onpointerup={stopPan} onpointercancel={stopPan} onwheel={zoomAt}>
      <title>Stable topic geography with compact dots and plain names that fade in as you zoom.</title>
      <defs><clipPath id="atlas-fusion-clip"><rect width={width} height={height}/></clipPath></defs>
      <g clip-path="url(#atlas-fusion-clip)">
        <g class="map-world" transform={`translate(${width / 2 + panX} ${height / 2 + panY}) scale(${cameraScale}) translate(${-cameraCenter.x} ${-cameraCenter.y})`}>
          {#each graphClouds as item (item.cloud.id)}
            <polygon data-cloud-id={item.cloud.id} points={item.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={item.color} fill-opacity="0.1" stroke={item.color} stroke-opacity="0.5" stroke-width="1.5"/>

          {/each}
          <g class="tile-links" pointer-events="none">{#each links as link (link.id)}
            {@const emphasized = !!hoveredId && hoveredId !== focusId && (link.sourceId === hoveredId || link.targetId === hoveredId)}
            <path data-link-source={link.sourceId} data-link-target={link.targetId} d={dotConnection(link)} fill="none" stroke={link.kind === 'wikilink' ? 'var(--color-foreground)' : 'color-mix(in srgb, #967aa9 65%, var(--color-foreground))'} vector-effect="non-scaling-stroke" stroke-width={emphasized ? 2.4 : incidentIds.has(link.id) ? 1.5 : 0.7} stroke-dasharray={link.kind === 'semantic' ? '6 5' : 'none'} opacity={emphasized ? 1 : incidentIds.has(link.id) ? 0.75 : 0.1}/>
          {/each}</g>
          <g class="graph-dots">
            {#each geometry.nodes as mark (mark.node.id)}
              <g class="note-dot" role="button" tabindex="0" data-node-id={mark.node.id} data-root-id={mark.rootId} aria-label={`Pin ${mark.node.fileName || mark.node.title}`}
                onmouseenter={() => hoveredId = mark.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = mark.node.id} onblur={() => hoveredId = null}
                onclick={() => clickNode(mark.node)} ondblclick={() => void openNode(mark.node)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (event.key === 'Enter') void openNode(mark.node); else pin(mark.node); } }}>
                <title>{mark.node.fileName || mark.node.title}</title>
                <circle class="dot-hit" cx={mark.x} cy={mark.y} r={Math.max(visibleRadius(mark.node.id), 8) / cameraScale} fill="transparent"/>
                <circle class="dot-body" cx={mark.x} cy={mark.y} r={visibleRadius(mark.node.id) / cameraScale} fill={mark.color} fill-opacity={dotOpacity(mark.node)} data-connectedness={connectedness(mark.node)} data-attention={attention(mark.node)} stroke={focusId === mark.node.id ? 'var(--color-foreground)' : 'none'} stroke-width="1.5" vector-effect="non-scaling-stroke"/>
              </g>
            {/each}
          </g>
          {#each graphClouds as item (item.cloud.id)}
            <g role="button" tabindex="0" data-region-id={item.cloud.id} aria-label={`Explore region ${regionName(item.cloud.label)}`} onclick={() => inspectRegion(item.cloud.parentId ?? item.cloud.id)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspectRegion(item.cloud.parentId ?? item.cloud.id); } }}>
              <text x={item.labelPoint.x} y={item.labelPoint.y} text-anchor="middle" font-size={item.labelFontSize} font-weight="550" fill="var(--color-muted-foreground)">{regionName(item.cloud.label).slice(0, 32)}</text>
            </g>
          {/each}
        </g>
        <g class="filename-labels">
          {#each filenameLabels as label (label.node.id)}
            <g class="note-name" role="button" tabindex={label.opacity > 0.05 ? 0 : -1} aria-hidden={label.opacity <= 0.01} pointer-events={label.opacity > 0.05 ? 'auto' : 'none'} data-filename-id={label.node.id} aria-label={`Read ${label.node.fileName || label.node.title}`}
              onmouseenter={() => hoveredId = label.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = label.node.id} onblur={() => hoveredId = null}
              onclick={() => clickNode(label.node)} ondblclick={() => void openNode(label.node)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (event.key === 'Enter') void openNode(label.node); else pin(label.node); } }}>
              <title>{label.node.fileName || label.node.title}</title>
              <text x={label.x} y={label.y} text-anchor="middle" font-size={labelSize} font-weight={activeId === label.node.id ? '600' : '400'} fill="var(--color-foreground)" stroke="var(--color-background)" stroke-width={0.8 * cameraScale} stroke-linejoin="round" paint-order="stroke" opacity={label.opacity}>{label.title}</text>
            </g>
          {/each}
        </g>
      </g>
      {#if !response.nodes.length}<text x={width / 2} y={height / 2} text-anchor="middle" fill="var(--color-muted-foreground)">No notes in this snapshot.</text>{/if}
    </svg>
    {#if hovered && !active}
      <div class="hover-preview" style:left={`${hoverPosition.x}px`} style:top={`${hoverPosition.y}px`}><strong>{hovered.node.title || hovered.node.fileName}</strong><p>{excerptText(hovered.node.preview) || 'No excerpt available.'}</p><span>{activityText(hovered.node)} · click to pin</span></div>
    {/if}
  </div>
  <aside class="dock" class:dock-open={panelOpen} aria-label="Atlas info">
    <button class="regions-toggle" aria-label={panelOpen ? 'Collapse Atlas info' : 'Show Atlas regions'} aria-expanded={panelOpen} aria-controls="atlas-info-body" onclick={() => { if (panelOpen) closeCard(); else panelOpen = true; }}>
      <span>{active ? 'Note' : 'Regions'}</span><ChevronDown class="info-chevron" />
    </button>
    {#if panelOpen}
    <div class="info-body" id="atlas-info-body">
    {#if active}
      <article class="reader" onwheel={wheelCard} aria-label="Note reader">
        <h2>{(active.node.fileName || active.node.title).replace(/\.md$/i, '')}</h2><p class="activity-detail">{activityText(active.node)}</p>
        <div class="browse"><span>{query.trim() ? 'Search matches' : 'Connected notes'}</span><div><button disabled={!pool.length} onclick={() => cycle(-1)} aria-label="Previous Atlas note">↑</button><span>{poolIndex >= 0 ? poolIndex + 1 : '–'} / {pool.length}</span><button disabled={!pool.length} onclick={() => cycle(1)} aria-label="Next Atlas note">↓</button></div></div>
        {#if fullText !== null}<div class="full-source" tabindex="0" role="textbox" aria-readonly="true" aria-label="Full note source">{fullText}</div>{:else}<div class="reader-excerpt">{excerptText(active.node.preview) || 'No excerpt available for this note.'}</div>{/if}
        <div class="reader-footer"><span>{eligibleLinks.filter((link) => link.sourceId === active.node.id || link.targetId === active.node.id).length} connections · scroll preview to browse</span><button onclick={() => active && void openNode(active.node)}>Open in editor</button><button disabled={readStatus === 'loading'} onclick={loadSource}>{readStatus === 'loading' ? 'Loading…' : fullText !== null ? 'Reload source' : 'Read full note'}</button>{#if readStatus === 'error'}<small>Could not load this note. Try again.</small>{/if}</div>
      </article>
    {/if}
    {#if !active}
      {#key inspectedRegionId}<section class="region-guide" aria-label="Region guide">
        {#if inspectedRegion}
          <div class="guide-heading"><strong>Notes in this region</strong><div><button onclick={() => { inspectedRegionId = null; reset(); }}>All regions</button></div></div>
          <h2 class="region-name">{inspectedRegion.name}</h2>
          <p class="region-count">{inspectedRegion.cloud.noteCount} notes · examples from this region</p>
          <div class="region-examples">{#each inspectedRegion.examples as node (node.id)}<button onclick={() => pin(node)}><strong>{node.title || node.fileName}</strong><span>{excerptText(node.preview).slice(0, 150)}</span></button>{/each}</div>
        {:else}
          <div class="guide-heading"><strong>Regions · {regions.length}</strong></div>
          <p class="guide-help">Larger dots have stronger or more Atlas connections. Brighter dots have more recent opening activity; dimmer notes remain available to rediscover.</p>
          <div class="region-list">{#each regions as region (region.cloud.id)}<button onclick={() => inspectRegion(region.cloud.id)}><span><i style:background={region.color}></i><strong>{region.name}</strong><small>{region.cloud.noteCount}</small></span><p>{region.examples.slice(0, 2).map((node) => node.title || node.fileName).join(' · ') || 'No example notes available.'}</p></button>{/each}</div>
        {/if}
      </section>{/key}
    {/if}
    </div>
    {/if}
  </aside>
  </div>
  {@render search(reset)}
</section>

<style>
  .fusion{container-type:inline-size;position:relative;height:100%;width:100%;min-height:0;color:var(--color-foreground)}
  .workbench{position:absolute;inset:0;overflow:hidden}
  .plot{position:absolute;inset:0;overflow:hidden;background:var(--color-background)}
  svg{width:100%;height:100%;touch-action:none;user-select:none;cursor:grab}svg:active{cursor:grabbing}
  svg g[role=button]{cursor:pointer;outline:none}svg g[role=button]:focus-visible>.dot-body,.note-dot:hover>.dot-body{stroke:var(--color-foreground);stroke-width:2px}
  .note-name:focus-visible>text{fill:var(--color-ring)}.note-name text{transition:opacity 120ms linear}
  @media(prefers-reduced-motion:reduce){.note-name text{transition:none}}
  button{cursor:pointer;color:var(--color-foreground)}button:disabled{opacity:.4;cursor:default}
  button:focus-visible,.full-source:focus-visible{outline:2px solid var(--color-ring);outline-offset:2px}
  .dock{position:absolute;right:20px;top:16px;width:110px;height:40px;z-index:12;border:1px solid var(--color-border);border-radius:20px;background:color-mix(in srgb,var(--color-background) 94%,transparent);overflow:hidden;backdrop-filter:blur(16px);transform-origin:top right;transition:width 220ms cubic-bezier(.2,.8,.2,1),height 220ms cubic-bezier(.2,.8,.2,1),border-radius 220ms,box-shadow 220ms}
  .dock-open{width:min(340px,calc(100% - 40px));height:min(560px,calc(100% - 140px));border-radius:16px;box-shadow:0 10px 35px #0003}
  .regions-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:39px;padding:8px 13px;font-size:12px;text-align:left}
  .regions-toggle:hover{background:var(--color-accent)}
  .regions-toggle :global(.info-chevron){width:14px;height:14px;flex-shrink:0;transition:transform 220ms}
  .dock-open .regions-toggle :global(.info-chevron){transform:rotate(180deg)}
  .info-body{height:calc(100% - 39px);overflow:hidden;animation:info-reveal 180ms ease both}
  @keyframes info-reveal{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
  @media(prefers-reduced-motion:reduce){.dock,.regions-toggle :global(.info-chevron){transition:none}.info-body{animation:none}}
  .reader{height:100%;display:flex;flex-direction:column;overflow:hidden;padding:18px}
  .guide-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--color-muted-foreground)}
  .reader h2{font-size:20px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;margin:10px 0 6px}
  .activity-detail{font-size:11px;line-height:1.5;color:var(--color-muted-foreground);margin:0 0 12px}
  .browse{display:flex;justify-content:space-between;align-items:center;gap:8px;border-block:1px solid var(--color-border);padding:9px 0;font-size:11px;color:var(--color-muted-foreground)}
  .browse>div{display:flex;gap:7px;align-items:center}.browse button{border:1px solid var(--color-border);border-radius:6px;width:30px;height:30px;font-size:15px}
  .reader-excerpt,.full-source{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;margin:12px 0;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
  .reader-footer{display:flex;flex-wrap:wrap;align-items:center;gap:9px;border-top:1px solid var(--color-border);padding-top:12px;color:var(--color-muted-foreground);font-size:10px}
  .reader-footer button,.guide-heading button{padding:7px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:11px;min-height:30px}
  .reader h2,.activity-detail,.browse,.reader-footer{flex-shrink:0}
  .region-guide{height:100%;overflow:auto;padding:18px;overscroll-behavior:contain}
  .guide-heading{font-size:14px;color:var(--color-foreground)}.guide-heading>div{display:flex;gap:5px}
  .guide-help,.region-count{font-size:12px;line-height:1.6;color:var(--color-muted-foreground);margin:12px 0}
  .region-list{display:flex;flex-direction:column}.region-list>button{padding:12px 0;border-bottom:1px solid var(--color-border);text-align:left;width:100%}
  .region-list>button>span{display:flex;gap:8px;align-items:center;font-size:13px}.region-list i{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .region-list small{margin-left:auto;color:var(--color-muted-foreground);font-size:11px}
  .region-list p{font-size:11px;line-height:1.6;color:var(--color-muted-foreground);margin:6px 0 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
  .region-name{font-size:18px;margin-top:16px}
  .region-examples{display:flex;flex-direction:column}.region-examples button{padding:12px 0;border-bottom:1px solid var(--color-border);text-align:left}
  .region-examples strong{display:block;font-size:13px;font-weight:550}.region-examples span{display:block;font-size:12px;line-height:1.6;color:var(--color-muted-foreground);margin-top:6px}
  .hover-preview{position:absolute;width:208px;max-height:88px;overflow:hidden;pointer-events:none;z-index:4;background:color-mix(in srgb,var(--color-background) 97%,transparent);border:1px solid var(--color-border);border-radius:6px;padding:8px;box-shadow:0 4px 13px #00000012}
  .hover-preview strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:600}.hover-preview p{font-size:9px;line-height:1.5;color:var(--color-muted-foreground);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;margin:4px 0}.hover-preview>span{font-size:8px;color:var(--color-muted-foreground)}
  @container(max-width:450px){.dock{right:12px;top:12px}.dock-open{width:calc(100% - 24px);height:min(560px,calc(100% - 124px));border-radius:14px}.reader,.region-guide{padding:14px}.reader h2{font-size:17px;margin:5px 0}.activity-detail{margin-bottom:7px}.browse{padding:6px 0}.reader-excerpt,.full-source{margin:8px 0}.reader-footer{padding-top:8px}}
</style>
