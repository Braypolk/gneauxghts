<script lang="ts">
  // V3 experiment: one block layout at every zoom; blocks, titles and topic boundaries share one camera.
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
  let activityMode = $state<'none' | 'recency' | 'frequency'>('none');
  let regionNames = $state<Record<string, string>>({});
  let inspectedRegionId = $state<string | null>(null);
  let workbenchElement = $state<HTMLDivElement | null>(null);
  let scope = $state<'all' | 'search' | 'topic' | 'connected'>('all');
  let activeId = $state<string | null>(null);
  let browseOriginId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let zoom = $state(1), panX = $state(0), panY = $state(0);
  let showChildren = $state(false);
  let plotElement = $state<HTMLDivElement | null>(null);
  let svgElement: SVGSVGElement;
  let width = $state(1000), height = $state(560);
  let drag = $state<{ id: number; x: number; y: number; originalX: number; originalY: number } | null>(null);
  let fullText = $state<string | null>(null);
  let readStatus = $state<'idle' | 'loading' | 'error'>('idle');
  let readSequence = 0, wheelTime = 0;
  let zoomFrame = 0, pendingZoomDelta = 0;
  let pendingZoomPoint: Point | null = null;
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
    const scale = Math.min(2400 / Math.max(1, maxX - minX), 1440 / Math.max(1, maxY - minY));
    const project = (x: number, y: number): Point => ({ x: (x - (minX + maxX) / 2) * scale, y: (y - (minY + maxY) / 2) * scale });
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
  // A pinned note owns the neighborhood until closed or another note is chosen.
  let focusId = $derived(activeId ?? hoveredId);
  let incident = $derived(eligibleLinks.filter((link) => link.sourceId === focusId || link.targetId === focusId).sort((a, b) => b.strength - a.strength));
  let incidentIds = $derived(new Set(incident.map((link) => link.id)));
  let relatedNodeIds = $derived(new Set([...(focusId ? [focusId] : []), ...incident.flatMap((link) => [link.sourceId, link.targetId])]));
  // Quiet overview; exploring a note reveals its connections without a permanent web of edges.
  let links = $derived(eligibleLinks.filter((link) => allLinks || incidentIds.has(link.id)));
  const titleLimit = 60;
  function tileTitle(node: AtlasNode) {
    const name = (node.fileName || node.title).replace(/\.md$/i, '');
    return name.length > titleLimit ? `${name.slice(0, titleLimit - 1).trimEnd()}…` : name;
  }
  // Account for block dimensions from the start. This layout depends only on
  // the dataset; the camera, selection, hover and query cannot repack it.
  let blockLayout = $derived.by(() => {
    const placed: { x: number; y: number; width: number; height: number }[] = [];
    return [...geometry.nodes].sort((a, b) => a.y - b.y || a.x - b.x || a.node.id.localeCompare(b.node.id)).map((mark) => {
      const name = tileTitle(mark.node), lines: string[] = [];
      let remaining = name;
      while (remaining.length > 25) {
        const space = remaining.lastIndexOf(' ', 25);
        const split = space > 10 ? space : 25;
        lines.push(remaining.slice(0, split)); remaining = remaining.slice(split).trimStart();
      }
      lines.push(remaining);
      const tileWidth = 190, tileHeight = Math.max(48, lines.length * 16 + 16);
      const anchor = { x: mark.x, y: mark.y };
      let box = { x: anchor.x - tileWidth / 2, y: anchor.y - tileHeight / 2, width: tileWidth, height: tileHeight };
      const collides = (candidate: typeof box) => placed.some((other) => candidate.x < other.x + other.width + 12 && candidate.x + candidate.width + 12 > other.x && candidate.y < other.y + other.height + 12 && candidate.y + candidate.height + 12 > other.y);
      // Nearest available space around the native position. No screen-edge clamp:
      // dense regions gain breathing room and remain reachable by panning.
      for (let ring = 0; collides(box); ring++) {
        const radius = 20 + ring * 16;
        const attempts = Math.max(12, Math.ceil(radius / 8));
        let found = false;
        for (let i = 0; i < attempts; i++) {
          const angle = i / attempts * Math.PI * 2;
          const candidate = { ...box, x: anchor.x + Math.cos(angle) * radius - tileWidth / 2, y: anchor.y + Math.sin(angle) * radius - tileHeight / 2 };
          if (!collides(candidate)) { box = candidate; found = true; break; }
        }
        if (found) break;
      }
      placed.push(box);
      return { ...box, node: mark.node, color: mark.color, lines };
    });
  });
  let blockById = $derived(new Map(blockLayout.map((tile) => [tile.node.id, { ...tile, center: { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 } }])));
  function convexHull(points: Point[]): Point[] {
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    if (sorted.length < 3) return sorted;
    const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const half = (values: Point[]) => {
      const result: Point[] = [];
      for (const point of values) {
        while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop();
        result.push(point);
      }
      return result.slice(0, -1);
    };
    return [...half(sorted), ...half([...sorted].reverse())];
  }
  // Topic boundaries now enclose their actual blocks, rather than the old dots.
  let blockClouds = $derived(geometry.clouds.map((item) => {
    const members = blockLayout.filter((tile) => item.cloud.memberNodeIds.includes(tile.node.id));
    const points = convexHull(members.flatMap((tile) => [
      { x: tile.x - 22, y: tile.y - 34 }, { x: tile.x + tile.width + 22, y: tile.y - 34 },
      { x: tile.x + tile.width + 22, y: tile.y + tile.height + 22 }, { x: tile.x - 22, y: tile.y + tile.height + 22 }
    ]));
    const top = points.length ? Math.min(...points.map((point) => point.y)) : 0;
    const topEdge = points.filter((point) => point.y === top);
    return { ...item, points, labelPoint: { x: topEdge.length ? Math.min(...topEdge.map((point) => point.x)) + 22 : 0, y: top + 20 } };
  }).filter((item) => item.points.length));
  let worldBounds = $derived.by(() => {
    const points = blockClouds.flatMap((cloud) => cloud.points).concat(blockLayout.flatMap((tile) => [{ x: tile.x, y: tile.y }, { x: tile.x + tile.width, y: tile.y + tile.height }]));
    const minX = points.length ? Math.min(...points.map((point) => point.x)) : -100;
    const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 100;
    const minY = points.length ? Math.min(...points.map((point) => point.y)) : -100;
    const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 100;
    return { center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  });
  let fitScale = $derived(Math.min(Math.max(1, width - 32) / worldBounds.width, Math.max(1, height - 32) / worldBounds.height));
  let cameraScale = $derived(zoom);
  const screen = (point: Point): Point => ({ x: width / 2 + (point.x - worldBounds.center.x) * cameraScale + panX, y: height / 2 + (point.y - worldBounds.center.y) * cameraScale + panY });
  let filenameLabels = $derived(blockLayout.filter((tile) => !activeId || relatedNodeIds.has(tile.node.id)));
  function tileConnection(link: AtlasLink) {
    const a = blockById.get(link.sourceId)!, b = blockById.get(link.targetId)!;
    const edge = (tile: typeof a, other: typeof a) => {
      const dx = other.center.x - tile.center.x, dy = other.center.y - tile.center.y;
      const factor = Math.min((tile.width / 2) / Math.max(0.001, Math.abs(dx)), (tile.height / 2) / Math.max(0.001, Math.abs(dy)));
      return { x: tile.center.x + dx * factor, y: tile.center.y + dy * factor };
    };
    const start = edge(a, b), end = edge(b, a);
    return `M${start.x},${start.y}L${end.x},${end.y}`;
  }
  const regionName = (id: string, fallback: string | null) => regionNames[id]?.trim() || fallback || 'Unlabelled region';
  let regions = $derived(geometry.clouds.filter((item) => !item.cloud.parentId).map((item) => ({
    ...item, name: regionName(item.cloud.id, item.cloud.label),
    examples: item.cloud.representativeNodeIds.map((id) => byId.get(id)?.node).filter((node): node is AtlasNode => !!node)
  })));
  let inspectedRegion = $derived(regions.find((item) => item.cloud.id === inspectedRegionId));
  function inspectRegion(id: string) { closeCard(); inspectedRegionId = id; }
  let hoverPosition = $derived.by(() => {
    const tile = hovered ? blockById.get(hovered.node.id) : null;
    const point = tile ? screen({ x: tile.x + tile.width, y: tile.y }) : { x: 0, y: 0 };
    const x = point.x + 224 <= width ? point.x + 8 : point.x - (tile?.width ?? 0) * cameraScale - 224;
    return { x: Math.max(8, Math.min(width - 216, x)), y: Math.max(8, Math.min(height - 88, point.y)) };
  });
  function usage(node: AtlasNode): number | null {
    const value = activity?.counts[node.id];
    return activity?.countAvailable && typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
  }
  function activityShape(node: AtlasNode): 'circle' | 'diamond' | 'triangle' {
    if (activityMode === 'none') return 'circle';
    if (activityMode === 'frequency' && activity?.countAvailable) {
      const count = usage(node);
      return count === null ? 'triangle' : count > 0 ? 'circle' : 'diamond';
    }
    if (!node.lastViewedAtMillis) return 'triangle';
    const days = Math.max(0, (Date.now() - node.lastViewedAtMillis) / 86400000);
    return days <= 7 ? 'circle' : 'diamond';
  }
  function glyphPath(shape: 'circle' | 'diamond' | 'triangle', x: number, y: number, r: number) {
    if (shape === 'circle') return `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;
    if (shape === 'diamond') return `M${x},${y - r * 1.2}L${x + r * 1.2},${y}L${x},${y + r * 1.2}L${x - r * 1.2},${y}Z`;
    return `M${x},${y - r * 1.2}L${x + r * 1.2},${y + r}L${x - r * 1.2},${y + r}Z`;
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
  function changeActive(node: AtlasNode, startOrigin: boolean) {
    activeId = node.id; fullText = null; readStatus = 'idle'; readSequence++;
    if (startOrigin || !browseOriginId) browseOriginId = node.id;
  }
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
    if (!active || !workbenchElement?.contains(element) || element.closest('input,textarea,select,.full-source,[contenteditable="true"]') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); cycle(event.key === 'ArrowDown' ? 1 : -1);
  }
  async function loadSource() {
    if (!active || !readSource) return;
    const id = active.node.id, sequence = ++readSequence;
    readStatus = 'loading';
    try { const text = await readSource(active.node); if (sequence === readSequence && activeId === id) { fullText = text; readStatus = 'idle'; } }
    catch { if (sequence === readSequence && activeId === id) readStatus = 'error'; }
  }
  function closeCard() { activeId = null; fullText = null; readStatus = 'idle'; readSequence++; }
  function canvasPoint(event: PointerEvent | WheelEvent): Point {
    const matrix = svgElement.getScreenCTM();
    if (!matrix) return { x: width / 2, y: height / 2 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  function startPan(event: PointerEvent) {
    if (event.button !== 0 || (event.target as Element).closest('[role="button"]')) return;
    const point = canvasPoint(event); drag = { id: event.pointerId, ...point, originalX: panX, originalY: panY };
    svgElement.setPointerCapture(event.pointerId);
  }
  function movePan(event: PointerEvent) { if (!drag) return; const point = canvasPoint(event); panX = drag.originalX + point.x - drag.x; panY = drag.originalY + point.y - drag.y; }
  function stopPan(event: PointerEvent) { drag = null; if (svgElement.hasPointerCapture(event.pointerId)) svgElement.releasePointerCapture(event.pointerId); }
  function setZoomAt(next: number, point: Point) {
    next = Math.max(0.04, Math.min(4, next));
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
  function stepZoom(direction: number) {
    clearZoomQueue(); setZoomAt(zoom * Math.pow(1.15, direction), { x: width / 2, y: height / 2 });
  }
  function reset() { clearZoomQueue(); zoom = fitScale; panX = 0; panY = 0; }
  $effect(() => {
    const text = query.trim();
    const dataset = `${response.structuralGeneration}:${response.revision}:${response.nodes.length}`;
    if (lastQuery === text && lastSearchDataset === dataset) return;
    lastQuery = text;
    lastSearchDataset = dataset;
    if (!text) return;
    scope = 'search';
    const first = response.nodes.find((node) => matchesQuery(node, text));
    if (first) { changeActive(first, true); browseOriginId = first.id; } else closeCard();
  });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) { width = entry.contentRect.width; height = entry.contentRect.height; } });
    if (plotElement) observer.observe(plotElement);
    return () => { observer.disconnect(); clearZoomQueue(); };
  });
</script>

<svelte:window onkeydown={keyBrowse}/>
<section class="fusion" aria-label="Atlas fusion hybrid visualization">
  <header><div><h1>Atlas, with your notes within reach.</h1><p>One block map · titles scale with zoom · read without covering the map</p></div><span>{response.nodes.length} notes{query.trim() ? ` · ${matching.length} matches` : ''}</span></header>
  <div class="controls">
    <label>Connections <select bind:value={kind} aria-label="Fusion connection type"><option value="both">Linked + similar</option><option value="wikilink">Explicit links</option><option value="semantic">Semantic matches</option></select></label>
    <label>Strength <input type="range" min="0" max="1" step="0.05" bind:value={threshold} aria-label="Fusion connection strength"/><output>{Number(threshold).toFixed(2)}</output></label>
    <label><input type="checkbox" bind:checked={allLinks}/>All links</label>
    <label>Activity <select bind:value={activityMode} aria-label="Fusion activity encoding"><option value="none">Off</option><option value="recency">Last opened</option>{#if activity?.countAvailable}<option value="frequency">Opening activity</option>{/if}</select></label>
    <label><input type="checkbox" bind:checked={showChildren}/>Subtopics</label>
    <div class="map-controls"><button onclick={() => stepZoom(-1)} aria-label="Fusion zoom out">−</button><span>{zoom.toFixed(2)}×</span><button onclick={() => stepZoom(1)} aria-label="Fusion zoom in">+</button><button onclick={reset}>Fit map</button></div>
  </div>
  <div class="workbench" bind:this={workbenchElement}>
  <div class="plot" bind:this={plotElement}>
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Atlas block map with all ${response.nodes.length} notes`} onpointerdown={startPan} onpointermove={movePan} onpointerup={stopPan} onpointercancel={stopPan} onwheel={zoomAt}>
      <title>One stable block layout with titles and topic boundaries that scale together.</title>
      <defs><clipPath id="atlas-fusion-clip"><rect width={width} height={height}/></clipPath></defs>
      <g clip-path="url(#atlas-fusion-clip)">
        <g class="map-world" transform={`translate(${width / 2 + panX} ${height / 2 + panY}) scale(${cameraScale}) translate(${-worldBounds.center.x} ${-worldBounds.center.y})`}>
          {#each blockClouds.filter((item) => !item.cloud.parentId || showChildren) as item (item.cloud.id)}
            <polygon data-cloud-id={item.cloud.id} points={item.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={item.color} fill-opacity={item.cloud.parentId ? 0.05 : 0.1} stroke={item.color} stroke-opacity="0.5" stroke-width="1.5" stroke-dasharray={item.cloud.parentId ? '5 5' : 'none'}/>
            <g role="button" tabindex="0" data-region-id={item.cloud.id} aria-label={`Explore region ${regionName(item.cloud.id, item.cloud.label)}`} onclick={() => inspectRegion(item.cloud.parentId ?? item.cloud.id)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspectRegion(item.cloud.parentId ?? item.cloud.id); } }}>
              <text x={item.labelPoint.x} y={item.labelPoint.y} font-size="14" font-weight="600" fill="var(--color-muted-foreground)">{regionName(item.cloud.id, item.cloud.label).slice(0, 32)}</text>
            </g>
          {/each}
          <g class="tile-links" pointer-events="none">{#each links as link (link.id)}
            {@const emphasized = !!hoveredId && hoveredId !== focusId && (link.sourceId === hoveredId || link.targetId === hoveredId)}
            <path data-link-source={link.sourceId} data-link-target={link.targetId} d={tileConnection(link)} fill="none" stroke={link.kind === 'wikilink' ? 'var(--color-muted-foreground)' : '#967aa9'} stroke-width={emphasized ? 1.7 : 1} stroke-dasharray={link.kind === 'semantic' ? '4 4' : 'none'} opacity={emphasized ? 0.8 : incidentIds.has(link.id) ? 0.35 : 0.06}/>
          {/each}</g>
        <g class="filename-labels">
          {#each filenameLabels as label (label.node.id)}
            <g class="note-tile" role="button" tabindex="0" data-node-id={label.node.id} data-filename-id={label.node.id} aria-label={`Pin ${label.node.fileName || label.node.title}`}
              onmouseenter={() => hoveredId = label.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = label.node.id} onblur={() => hoveredId = null}
              onclick={() => pin(label.node)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pin(label.node); } }}>
              <title>{label.node.fileName || label.node.title}</title>
              <rect class="tile-body" x={label.x} y={label.y} width={label.width} height={label.height} rx="6" fill="var(--color-background)" stroke={focusId === label.node.id ? '#6f87b6' : 'var(--color-border)'} stroke-width={focusId === label.node.id ? 2 : 1}/>
              <path class="activity-glyph" data-activity-shape={activityShape(label.node)} d={glyphPath(activityShape(label.node), label.x + 11, label.y + 16, 3.5)} fill={label.color}/>
              <text x={label.x + 22} y={label.y + 20} font-size="12" font-weight={focusId === label.node.id ? '650' : '500'} fill={matchesQuery(label.node, query) ? 'var(--color-foreground)' : 'var(--color-muted-foreground)'}>{#each label.lines as line, index}<tspan x={label.x + 22} dy={index ? 16 : 0}>{line}</tspan>{/each}</text>
              {#if selectedIds.includes(label.node.id)}<text x={label.x + label.width - 7} y={label.y + label.height - 6} text-anchor="end" font-size="9" fill="var(--color-muted-foreground)">✓</text>{/if}
            </g>
          {/each}
        </g>
        </g>
      </g>
      {#if !response.nodes.length}<text x={width / 2} y={height / 2} text-anchor="middle" fill="var(--color-muted-foreground)">No notes in this snapshot.</text>{/if}
    </svg>
    {#if hovered && !active}
      <div class="hover-preview" style:left={`${hoverPosition.x}px`} style:top={`${hoverPosition.y}px`}><strong>{hovered.node.title || hovered.node.fileName}</strong><p>{excerptText(hovered.node.preview) || 'No excerpt available.'}</p><span>{activityText(hovered.node)} · click to pin</span></div>
    {/if}
    {#if activityMode !== 'none'}<div class="legend"><span><i class="circle"></i>{activityMode === 'frequency' ? 'Positive activity' : 'Opened within 7 days'}</span><span><i class="diamond"></i>{activityMode === 'frequency' ? 'Idle activity' : 'Opened earlier'}</span><span><i class="triangle"></i>{activityMode === 'frequency' ? 'No activity record' : 'No recorded opening'}</span><span>Color: topic · solid: linked · dashed: similar</span></div>{/if}
  </div>
  <aside class="dock" aria-label="Atlas reading and region dock">
    {#if active}
      <article class="reader" onwheel={wheelCard} aria-label="Note reader">
        <div class="reader-heading"><span>Selected note · wheel to glide</span><button onclick={closeCard} aria-label="Close note reader">×</button></div>
        <h2>{(active.node.fileName || active.node.title).replace(/\.md$/i, '')}</h2><p class="activity-detail">{activityText(active.node)}</p>
        <div class="browse"><label>Browse <select bind:value={scope} onchange={() => { if (active) browseOriginId = active.node.id; }} aria-label="Fusion browsing pool"><option value="all">All notes</option><option value="search">Search matches</option><option value="topic">This topic</option><option value="connected">Connected notes</option></select></label><div><button disabled={!pool.length} onclick={() => cycle(-1)} aria-label="Previous Atlas note">↑</button><span>{poolIndex >= 0 ? poolIndex + 1 : '–'} / {pool.length}</span><button disabled={!pool.length} onclick={() => cycle(1)} aria-label="Next Atlas note">↓</button></div></div>
        {#if fullText !== null}<div class="full-source" tabindex="0" role="textbox" aria-readonly="true" aria-label="Full note source">{fullText}</div>{:else}<div class="reader-excerpt">{excerptText(active.node.preview) || 'No excerpt available for this note.'}</div>{/if}
        <div class="reader-footer"><span>{eligibleLinks.filter((link) => link.sourceId === active.node.id || link.targetId === active.node.id).length} eligible connections</span><div><button onclick={() => onToggle(active!.node.id)}>{selectedIds.includes(active.node.id) ? '✓ Collected' : '+ Collect'}</button>{#if readSource}<button disabled={readStatus === 'loading'} onclick={loadSource}>{readStatus === 'loading' ? 'Loading…' : fullText !== null ? 'Reload source' : 'Read full source'}</button>{:else}<button onclick={() => onPreview(active!.node)}>Read source</button>{/if}</div>{#if readStatus === 'error'}<small>Could not load this source. Try again.</small>{/if}{#if !pool.length}<small>This browsing pool has no notes. Choose another scope.</small>{/if}</div>
      </article>
    {/if}
    {#if !active}
      <section class="region-guide" aria-label="Region guide">
        {#if inspectedRegion}
          <div class="guide-heading"><strong>Notes in this region</strong><button onclick={() => inspectedRegionId = null}>All regions</button></div>
          <label class="rename">Region name<input aria-label="Region name" value={inspectedRegion.name} oninput={(event) => regionNames = { ...regionNames, [inspectedRegion.cloud.id]: event.currentTarget.value }}/></label>
          <small class="rename-hint">Name changes stay in this prototype.</small>
          <p class="region-count">{inspectedRegion.cloud.noteCount} notes · examples from this region</p>
          <div class="region-examples">{#each inspectedRegion.examples as node (node.id)}<button onclick={() => pin(node)}><strong>{node.title || node.fileName}</strong><span>{excerptText(node.preview).slice(0, 150)}</span></button>{/each}</div>
        {:else}
          <div class="guide-heading"><strong>Regions</strong><span>{regions.length}</span></div>
          <p class="guide-help">Example notes give each region context. Select a region to see more or rename it.</p>
          <div class="region-list">{#each regions as region (region.cloud.id)}<button onclick={() => inspectedRegionId = region.cloud.id}><span><i style:background={region.color}></i><strong>{region.name}</strong><small>{region.cloud.noteCount}</small></span><p>{region.examples.slice(0, 2).map((node) => node.title || node.fileName).join(' · ') || 'No example notes available.'}</p></button>{/each}</div>
        {/if}
      </section>
    {/if}
  </aside>
  </div>
  <footer><span>{activityMode === 'frequency' && activity?.countAvailable ? 'Activity weight decays with idle time; it is not a lifetime open count.' : activityMode === 'none' ? 'Color: topic · solid: linked · dashed: similar. Activity is off.' : 'Opening recency is separate from semantic importance.'}</span>{#if activityMode !== 'none'}<span title={activity?.notice}>{activity?.notice || 'Opening activity counts unavailable; showing recorded recency.'}</span>{/if}</footer>
</section>

<style>
  .fusion{container-type:inline-size;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--color-foreground);outline:none}header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 12px 8px}h1{font-size:16px;font-weight:620;letter-spacing:-.025em;margin:0 0 3px}header p{font-size:10px;color:var(--color-muted-foreground);margin:0}header>span{font-size:10px;white-space:nowrap;color:var(--color-muted-foreground)}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:11px;padding:6px 12px;border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);font-size:10px;color:var(--color-muted-foreground)}.controls label{display:flex;align-items:center;gap:5px}.controls input[type=range]{width:65px;accent-color:#829fae}.controls input[type=checkbox]{accent-color:#829fae}output{width:23px}select{font-size:10px;background:var(--color-background);color:var(--color-foreground);border:1px solid var(--color-border);border-radius:4px;padding:4px}.map-controls{margin-left:auto;display:flex;align-items:center;gap:5px}.map-controls button{border:1px solid var(--color-border);padding:3px 6px;border-radius:4px;color:var(--color-foreground)}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible,select:focus-visible,.reader:focus-visible,.full-source:focus-visible{outline:2px solid var(--color-ring);outline-offset:2px}.plot{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--color-background)}svg{width:100%;height:100%;max-height:100%;touch-action:none;user-select:none;cursor:grab}svg:active{cursor:grabbing}svg g[role=button]{cursor:pointer;outline:none}svg g[role=button]:focus-visible>.tile-body{stroke:var(--color-ring);stroke-width:2px}.note-tile:hover>.tile-body{stroke:#6f87b6}
  .hover-preview{position:absolute;width:208px;max-height:88px;overflow:hidden;pointer-events:none;z-index:4;background:color-mix(in srgb,var(--color-background) 97%,transparent);border:1px solid var(--color-border);border-radius:6px;padding:8px;box-shadow:0 4px 13px #00000012}.hover-preview strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:600}.hover-preview p{font-size:9px;line-height:1.5;color:var(--color-muted-foreground);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;margin:4px 0}.hover-preview>span{font-size:8px;color:var(--color-muted-foreground)}
  .workbench{flex:1;min-height:360px;display:grid;grid-template-columns:minmax(0,1fr) 304px;overflow:hidden}.dock{min-height:0;min-width:0;border-left:1px solid var(--color-border);background:var(--color-background);overflow:hidden}.reader{height:100%;display:flex;flex-direction:column;gap:0;overflow:hidden;padding:12px;background:var(--color-background)}.reader-heading{display:flex;align-items:center;justify-content:space-between;font-size:8px;color:var(--color-muted-foreground)}.reader-heading button{font-size:16px;line-height:1}.reader h2{font-size:13px;font-weight:620;line-height:1.35;white-space:normal;overflow-wrap:anywhere;margin:6px 0 3px}.activity-detail{font-size:8px;color:var(--color-muted-foreground);margin:0 0 7px}.browse{display:flex;justify-content:space-between;align-items:center;gap:7px;border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);padding:6px 0;font-size:9px}.browse label,.browse>div{display:flex;gap:5px;align-items:center}.browse select{font-size:9px;padding:3px;max-width:114px}.browse button{font-size:12px;border:1px solid var(--color-border);border-radius:3px;width:20px;height:20px}.browse>div>span{font-size:8px;white-space:nowrap}.reader-excerpt,.full-source{flex:1;min-height:0;overflow:auto;margin:8px 0;font-size:11px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.reader-excerpt{overflow:auto;overscroll-behavior:contain}.full-source{font-size:10px;padding-right:3px;overscroll-behavior:contain}.reader-footer{border-top:1px solid var(--color-border);padding-top:7px;font-size:8px;color:var(--color-muted-foreground)}.reader-footer>div{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}.reader-footer button{padding:4px 6px;border:1px solid var(--color-border);border-radius:4px;font-size:9px;color:var(--color-foreground)}.reader-footer small{display:block;margin-top:4px;font-size:8px}
  .reader-heading,.reader h2,.activity-detail,.browse,.reader-footer{flex-shrink:0}
  .legend{position:absolute;bottom:10px;left:12px;display:flex;flex-wrap:wrap;gap:10px;font-size:8px;color:var(--color-muted-foreground);pointer-events:none;background:color-mix(in srgb,var(--color-background) 80%,transparent);padding:4px 5px;border-radius:4px}.legend span{display:flex;gap:4px;align-items:center}.legend i{display:inline-block;background:var(--color-muted-foreground);width:8px;height:8px;flex-shrink:0}.legend .circle{border-radius:50%}.legend .diamond{transform:rotate(45deg);width:7px;height:7px;margin:0 1px}.legend .triangle{clip-path:polygon(50% 0,100% 100%,0 100%);width:10px;height:9px}footer{display:flex;gap:5px 15px;justify-content:space-between;padding:5px 12px;font-size:8px;color:var(--color-muted-foreground)}footer>span:last-child{max-width:50%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .controls button,.controls select{min-height:28px}.reader button,.reader select{min-height:26px}.reader-heading button{min-width:26px}.reader .browse button{width:26px;height:26px}.region-guide{height:100%;overflow:auto;padding:12px;overscroll-behavior:contain}.guide-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}.guide-heading span,.guide-help,.rename-hint,.region-count{font-size:10px;color:var(--color-muted-foreground)}.guide-heading button{font-size:10px;min-height:28px;border:1px solid var(--color-border);border-radius:4px;padding:4px 7px}.guide-help{line-height:1.5;margin:7px 0 10px}.region-list{display:flex;flex-direction:column;gap:2px}.region-list>button{padding:9px 0;border-bottom:1px solid var(--color-border);text-align:left;width:100%}.region-list>button>span{display:flex;gap:6px;align-items:center;font-size:11px}.region-list i{width:7px;height:7px;border-radius:50%;flex-shrink:0}.region-list small{margin-left:auto;color:var(--color-muted-foreground);font-size:9px}.region-list p{font-size:10px;line-height:1.45;color:var(--color-muted-foreground);margin:5px 0 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}.rename{display:flex;flex-direction:column;gap:5px;margin-top:14px;font-size:10px;color:var(--color-muted-foreground)}.rename input{width:100%;font-size:13px;color:var(--color-foreground);background:var(--color-background);border:1px solid var(--color-border);border-radius:4px;padding:7px;min-height:30px}.rename-hint{display:block;margin-top:5px;font-size:9px}.region-count{margin:13px 0 7px}.region-examples{display:flex;flex-direction:column}.region-examples button{padding:10px 0;border-bottom:1px solid var(--color-border);text-align:left}.region-examples strong{display:block;font-size:11px;font-weight:550}.region-examples span{display:block;font-size:10px;line-height:1.5;color:var(--color-muted-foreground);margin-top:5px}
  @container(max-width:760px){.workbench{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(210px,1fr) 220px;min-height:430px;flex-shrink:0}.dock{border-left:0;border-top:1px solid var(--color-border)}.reader{padding:10px}.reader h2{font-size:12px;line-height:1.3;margin:4px 0}.reader .activity-detail{font-size:8px;margin:0 0 4px}.reader .browse{padding:4px 0}.reader .reader-footer{padding-top:4px}.reader .reader-footer>div{margin-top:3px}.reader-excerpt,.full-source{margin:5px 0;font-size:10px;line-height:1.5}.reader-footer button{padding:3px 5px;font-size:9px}.region-guide{padding:10px}.guide-help{margin:5px 0 7px}}
  @container(max-width:450px){header{display:none}}
  @media(max-width:850px){.controls{gap:7px}.controls input[type=range]{width:45px}.map-controls{margin-left:0}header p{font-size:9px}.legend{gap:6px}.reader{padding:9px}footer>span:last-child{max-width:45%}}@media(max-width:560px){header p,header>span{display:none}.reader .activity-detail{display:block;font-size:8px;line-height:1.2;margin:0 0 4px}.reader h2{margin:4px 0}.reader .browse{padding:4px 0}.reader .reader-footer>span{display:none}.reader .reader-footer{padding-top:4px}.reader .reader-footer>div{margin-top:0}.reader .reader-excerpt{margin:5px 0;font-size:10px}.controls{font-size:9px;padding:5px 8px}.controls select{font-size:9px}.controls input[type=range]{width:40px}.legend span:last-child{display:none}footer>span:last-child{display:none}}
</style>
