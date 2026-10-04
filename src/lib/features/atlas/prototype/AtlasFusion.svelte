<script lang="ts">
  // V3 experiment: topic geography with spaced dots and zoom-faded plain names, inspired by Obsidian.
  import { onMount, type Snippet } from 'svelte';
  import type { AtlasNode, AtlasLink, VaultAtlasResponse } from '$lib/types/atlas';
  import { matchesQuery, daysAgo } from './types';
  type Activity = { counts: Record<string, number>; countAvailable: boolean; notice: string };
  type Props = { response: VaultAtlasResponse; query: string; activity?: Activity; readSource: (node: AtlasNode) => Promise<string>; search: Snippet<[() => void]> };
  type Point = { x: number; y: number };
  let { response, query, activity, readSource, search }: Props = $props();
  let regionNames = $state<Record<string, string>>({});
  let inspectedRegionId = $state<string | null>(null);
  let workbenchElement = $state<HTMLDivElement | null>(null);
  let activeId = $state<string | null>(null);
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
  let zoomFrame = 0, pendingZoomDelta = 0;
  let pendingZoomPoint: Point | null = null;
  let lastQuery = $state('');
  let lastSearchDataset = $state('');
  let hasPlotSize = $state(false), framedDataset = $state('');
  const palette = ['#6a9fac', '#aa8cbd', '#ad9a69', '#7f9c7d', '#b58895', '#879aca'];
  const nodeSpacing = 42, labelWorldSize = 6.5;
  function titleWidth(title: string, size: number) {
    return [...title].reduce((sum, char) => sum + ('ilI.,:;!| '.includes(char) ? 0.3 : 'MW@%'.includes(char) ? 0.85 : 0.56), 0) * size;
  }
  function insideWithMargin(point: Point, polygon: Point[], margin: number) {
    let inside = false, distance = Infinity;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(0.001, dx * dx + dy * dy)));
      distance = Math.min(distance, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
    }
    return inside && distance >= margin;
  }
  function fitCloud(points: Point[], members: Point[]) {
    let scale = 1, fitted = points;
    for (let pass = 0; pass < 120 && members.some((point) => !insideWithMargin(point, fitted, 20)); pass++) {
      scale *= 1.04; fitted = points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
    }
    return fitted;
  }
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
    // Pack nearby notes once per dataset, reserving their fixed world-space
    // names. Neither camera nor selected/hovered state enters layout.
    const groups = [...new Set(nodes.map((mark) => mark.rootId ?? mark.node.id))].map((id) => {
      const root = clouds.find((item) => item.cloud.id === id);
      const originals = nodes.filter((mark) => (mark.rootId ?? mark.node.id) === id);
      const anchor = root?.center ?? originals[0];
      const placed: (typeof nodes[number] & { box: { left: number; right: number; top: number; bottom: number } })[] = [];
      for (const mark of [...originals].sort((a, b) => a.y - b.y || a.x - b.x || a.node.id.localeCompare(b.node.id))) {
        const preferred = { x: mark.x - anchor.x, y: mark.y - anchor.y };
        const halfWidth = titleWidth(tileTitle(mark.node), labelWorldSize) * 1.12 / 2 + 3;
        const labelBox = (point: Point) => ({ left: point.x - halfWidth, right: point.x + halfWidth, top: point.y + 1, bottom: point.y + 18 });
        const collides = (point: Point) => {
          const box = labelBox(point);
          return placed.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < nodeSpacing ||
            (box.left < other.box.right && box.right > other.box.left && box.top < other.box.bottom && box.bottom > other.box.top));
        };
        let point = preferred;
        for (let ring = 1; collides(point); ring++) {
          const radius = ring * 6, attempts = Math.max(16, Math.ceil(radius / 3));
          let found = false;
          for (let i = 0; i < attempts; i++) {
            const angle = i / attempts * Math.PI * 2;
            const candidate = { x: preferred.x + Math.cos(angle) * radius, y: preferred.y + Math.sin(angle) * radius };
            if (!collides(candidate)) { point = candidate; found = true; break; }
          }
          if (found) break;
        }
        placed.push({ ...mark, ...point, box: labelBox(point) });
      }
      // Keep the original mean inside the region; avoid a directional packing drift.
      const offset = { x: (placed.reduce((sum, mark) => sum + mark.x, 0) - originals.reduce((sum, mark) => sum + mark.x - anchor.x, 0)) / originals.length,
        y: (placed.reduce((sum, mark) => sum + mark.y, 0) - originals.reduce((sum, mark) => sum + mark.y - anchor.y, 0)) / originals.length };
      for (const mark of placed) {
        mark.x -= offset.x; mark.y -= offset.y;
        mark.box.left -= offset.x; mark.box.right -= offset.x; mark.box.top -= offset.y; mark.box.bottom -= offset.y;
      }
      // Retain the original blob silhouette, growing it only enough to contain
      // the separated dots. Whole regions then move apart if their envelopes meet.
      const outline = root ? fitCloud(root.points.map((point) => ({ x: point.x - anchor.x, y: point.y - anchor.y })), placed) : [];
      const envelope = outline.concat(placed.flatMap((mark) => [{ x: mark.box.left, y: mark.box.top }, { x: mark.box.right, y: mark.box.bottom }]));
      const radius = Math.max(24, ...envelope.map((point) => Math.hypot(point.x, point.y))) + 12;
      return { id, anchor, x: anchor.x, y: anchor.y, placed, outline, radius };
    });
    for (let pass = 0; pass < 240; pass++) {
      let overlapFound = false;
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
        const overlap = a.radius + b.radius + 28 - distance;
        if (overlap <= 0) continue;
        overlapFound = true;
        const angle = (i * 7 + j * 3) * 2.4;
        const ux = distance > 0.001 ? dx / distance : Math.cos(angle), uy = distance > 0.001 ? dy / distance : Math.sin(angle);
        const shift = (overlap + 0.1) / 2;
        a.x -= ux * shift; a.y -= uy * shift; b.x += ux * shift; b.y += uy * shift;
      }
      if (!overlapFound) break;
    }
    const spacedNodes = groups.flatMap((group) => group.placed.map(({ box, ...mark }) => ({ ...mark, x: mark.x + group.x, y: mark.y + group.y })));
    const spacedClouds = clouds.map((item) => {
      const group = groups.find((group) => group.id === item.cloud.id);
      if (group) return { ...item, center: { x: group.x, y: group.y }, points: group.outline.map((point) => ({ x: point.x + group.x, y: point.y + group.y })) };
      const members = spacedNodes.filter((mark) => item.cloud.memberNodeIds.includes(mark.node.id));
      if (!members.length) return { ...item, points: [] };
      const center = { x: members.reduce((sum, mark) => sum + mark.x, 0) / members.length, y: members.reduce((sum, mark) => sum + mark.y, 0) / members.length };
      const outline = fitCloud(item.points.map((point) => ({ x: point.x - item.center.x, y: point.y - item.center.y })), members.map((mark) => ({ x: mark.x - center.x, y: mark.y - center.y })));
      return { ...item, center, points: outline.map((point) => ({ x: point.x + center.x, y: point.y + center.y })) };
    });
    return { nodes: spacedNodes, clouds: spacedClouds, project };
  });
  let byId = $derived(new Map(geometry.nodes.map((mark) => [mark.node.id, mark])));
  let active = $derived(byId.get(activeId ?? ''));
  let hovered = $derived(byId.get(hoveredId ?? ''));
  let origin = $derived(byId.get(browseOriginId ?? activeId ?? ''));
  let matching = $derived(response.nodes.filter((node) => matchesQuery(node, query)));
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
  let links = $derived(eligibleLinks.filter((link) => incidentIds.has(link.id)));
  const titleLimit = 60;
  function tileTitle(node: AtlasNode) {
    const name = (node.fileName || node.title).replace(/\.md$/i, '');
    return name.length > titleLimit ? `${name.slice(0, titleLimit - 1).trimEnd()}…` : name;
  }
  // Spaced geography stays fixed; camera and label visibility never repack it.
  let dotById = $derived(new Map(geometry.nodes.map((mark) => [mark.node.id, mark])));
  let graphClouds = $derived(geometry.clouds.filter((item) => item.points.length).map((item) => {
    const text = regionName(item.cloud.id, item.cloud.label).slice(0, 32);
    const top = Math.min(...item.points.map((point) => point.y));
    const bottom = Math.max(...item.points.map((point) => point.y));
    const left = Math.min(...item.points.map((point) => point.x)), right = Math.max(...item.points.map((point) => point.x));
    const middleX = (left + right) / 2;
    const occupied = geometry.nodes.filter((mark) => item.cloud.parentId ? item.cloud.memberNodeIds.includes(mark.node.id) : mark.rootId === item.cloud.id).map((mark) => {
      const halfWidth = Math.max(9, titleWidth(tileTitle(mark.node), labelWorldSize) * 1.12 / 2 + 2);
      return { left: mark.x - halfWidth, right: mark.x + halfWidth, top: mark.y - 9, bottom: mark.y + 19 };
    });
    let fallback: { labelPoint: Point; labelFontSize: number } | null = null;
    // Place the whole name inside the upper part of the original silhouette.
    // Narrow clouds can use smaller type; note positions and camera stay fixed.
    for (let size = 20; size >= 4; size--) {
      const halfWidth = titleWidth(text, size) * 1.12 / 2;
      const candidates = [item.center.x, middleX];
      for (let x = left + halfWidth + 8; x <= right - halfWidth - 8; x += 8) candidates.push(x);
      candidates.sort((a, b) => Math.abs(a - item.center.x) - Math.abs(b - item.center.x));
      for (let y = top + size + 8; y <= bottom - 8; y += 6) {
        for (const x of candidates) {
          const corners = [{ x: x - halfWidth, y: y - size }, { x: x + halfWidth, y: y - size }, { x: x - halfWidth, y: y + 4 }, { x: x + halfWidth, y: y + 4 }];
          if (!corners.every((point) => insideWithMargin(point, item.points, 4))) continue;
          const placement = { labelPoint: { x, y }, labelFontSize: size };
          fallback ??= placement;
          if (!occupied.some((box) => x - halfWidth < box.right && x + halfWidth > box.left && y - size < box.bottom && y + 4 > box.top)) return { ...item, ...placement };
        }
      }
    }
    return { ...item, ...(fallback ?? { labelPoint: item.center, labelFontSize: 4 }) };
  }));
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
  const screen = (point: Point): Point => ({ x: width / 2 + (point.x - worldBounds.center.x) * cameraScale + panX, y: height / 2 + (point.y - worldBounds.center.y) * cameraScale + panY });
  let explicitDegree = $derived.by(() => {
    const counts = new Map<string, Set<string>>();
    for (const link of response.links.filter((link) => link.kind === 'wikilink')) {
      if (!counts.has(link.sourceId)) counts.set(link.sourceId, new Set());
      if (!counts.has(link.targetId)) counts.set(link.targetId, new Set());
      counts.get(link.sourceId)!.add(link.targetId); counts.get(link.targetId)!.add(link.sourceId);
    }
    return new Map([...counts].map(([id, neighbors]) => [id, neighbors.size]));
  });
  const dotRadius = (id: string) => (5 + Math.min(5, Math.sqrt(explicitDegree.get(id) ?? 0))) * 0.65;
  const visibleRadius = (id: string) => Math.max(2, dotRadius(id) * cameraScale);
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
    const a = dotById.get(link.sourceId)!, b = dotById.get(link.targetId)!;
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
    if (distance < 0.001) return '';
    const start = Math.min(visibleRadius(a.node.id) / cameraScale, distance / 2), end = Math.min(visibleRadius(b.node.id) / cameraScale, distance / 2);
    return `M${a.x + dx / distance * start},${a.y + dy / distance * start}L${b.x - dx / distance * end},${b.y - dy / distance * end}`;
  }
  const regionName = (id: string, fallback: string | null) => regionNames[id]?.trim() || fallback || 'Unlabelled region';
  let regions = $derived(geometry.clouds.filter((item) => !item.cloud.parentId).map((item) => ({
    ...item, name: regionName(item.cloud.id, item.cloud.label),
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
    panX = (worldBounds.center.x - x) * zoom; panY = (worldBounds.center.y - y) * zoom;
  }
  let hoverPosition = $derived.by(() => {
    const point = hovered ? screen(hovered) : { x: 0, y: 0 };
    const x = point.x + 224 <= width ? point.x + 12 : point.x - 224;
    return { x: Math.max(8, Math.min(width - 216, x)), y: Math.max(8, Math.min(height - 88, point.y - 100)) };
  });
  function usage(node: AtlasNode): number | null {
    const value = activity?.counts[node.id];
    return activity?.countAvailable && typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
  }
  function activityText(node: AtlasNode) {
    const last = node.lastViewedAtMillis ? `Last opened ${daysAgo(node.lastViewedAtMillis).toLowerCase()}` : 'No recorded opening';
    const weight = usage(node);
    return activity?.countAvailable ? `${weight === null ? 'Activity weight unavailable' : `Activity weight ${weight.toFixed(1)}`} · ${last}` : last;
  }
  function excerptText(text: string) {
    // Keep link labels readable in the small preview; the full source retains exact Markdown.
    return text.replace(/\[([^\]\n]+)\]\((?:https?:\/\/|\/)[^)\s]+\)/g, '$1');
  }
  function changeActive(node: AtlasNode, startOrigin: boolean) {
    panelOpen = true; activeId = node.id; fullText = null; readStatus = 'idle'; readSequence++;
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
    if (event.key === 'Escape' && panelOpen && !element.closest('input,textarea,select')) { closeCard(); return; }
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
  function closeCard() { panelOpen = false; hoveredId = null; activeId = null; fullText = null; readStatus = 'idle'; readSequence++; }
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
  function reset() { clearZoomQueue(); zoom = fitScale; panX = 0; panY = 0; }
  $effect(() => {
    if (!hasPlotSize) return;
    const dataset = `${response.structuralGeneration}:${response.revision}:${response.nodes.length}`;
    if (framedDataset === dataset) return;
    framedDataset = dataset; reset();
  });
  $effect(() => {
    const text = query.trim();
    const dataset = `${response.structuralGeneration}:${response.revision}:${response.nodes.length}`;
    if (lastQuery === text && lastSearchDataset === dataset) return;
    lastQuery = text;
    lastSearchDataset = dataset;
    if (!text) return;
    const first = response.nodes.find((node) => matchesQuery(node, text));
    if (first) { changeActive(first, true); browseOriginId = first.id; } else closeCard();
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
        <g class="map-world" transform={`translate(${width / 2 + panX} ${height / 2 + panY}) scale(${cameraScale}) translate(${-worldBounds.center.x} ${-worldBounds.center.y})`}>
          {#each graphClouds.filter((item) => !item.cloud.parentId) as item (item.cloud.id)}
            <polygon data-cloud-id={item.cloud.id} points={item.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={item.color} fill-opacity={item.cloud.parentId ? 0.05 : 0.1} stroke={item.color} stroke-opacity="0.5" stroke-width="1.5" stroke-dasharray={item.cloud.parentId ? '5 5' : 'none'}/>

          {/each}
          <g class="tile-links" pointer-events="none">{#each links as link (link.id)}
            {@const emphasized = !!hoveredId && hoveredId !== focusId && (link.sourceId === hoveredId || link.targetId === hoveredId)}
            <path data-link-source={link.sourceId} data-link-target={link.targetId} d={dotConnection(link)} fill="none" stroke={link.kind === 'wikilink' ? 'var(--color-foreground)' : 'color-mix(in srgb, #967aa9 65%, var(--color-foreground))'} vector-effect="non-scaling-stroke" stroke-width={emphasized ? 2.4 : incidentIds.has(link.id) ? 1.5 : 0.7} stroke-dasharray={link.kind === 'semantic' ? '6 5' : 'none'} opacity={emphasized ? 1 : incidentIds.has(link.id) ? 0.75 : 0.1}/>
          {/each}</g>
          <g class="graph-dots">
            {#each geometry.nodes as mark (mark.node.id)}
              <g class="note-dot" role="button" tabindex="0" data-node-id={mark.node.id} data-root-id={mark.rootId} aria-label={`Pin ${mark.node.fileName || mark.node.title}`}
                opacity={activeId && !relatedNodeIds.has(mark.node.id) ? 0.18 : matchesQuery(mark.node, query) ? 1 : 0.25}
                onmouseenter={() => hoveredId = mark.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = mark.node.id} onblur={() => hoveredId = null}
                onclick={() => pin(mark.node)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pin(mark.node); } }}>
                <title>{mark.node.fileName || mark.node.title}</title>
                <circle class="dot-hit" cx={mark.x} cy={mark.y} r={Math.max(visibleRadius(mark.node.id), 8) / cameraScale} fill="transparent"/>
                <circle class="dot-body" cx={mark.x} cy={mark.y} r={visibleRadius(mark.node.id) / cameraScale} fill={mark.color} stroke={focusId === mark.node.id ? 'var(--color-foreground)' : 'none'} stroke-width="1.5" vector-effect="non-scaling-stroke"/>
              </g>
            {/each}
          </g>
          {#each graphClouds.filter((item) => !item.cloud.parentId) as item (item.cloud.id)}
            <g role="button" tabindex="0" data-region-id={item.cloud.id} aria-label={`Explore region ${regionName(item.cloud.id, item.cloud.label)}`} onclick={() => inspectRegion(item.cloud.parentId ?? item.cloud.id)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspectRegion(item.cloud.parentId ?? item.cloud.id); } }}>
              <text x={item.labelPoint.x} y={item.labelPoint.y} text-anchor="middle" font-size={item.labelFontSize} font-weight="550" fill="var(--color-muted-foreground)">{regionName(item.cloud.id, item.cloud.label).slice(0, 32)}</text>
            </g>
          {/each}
        </g>
        <g class="filename-labels">
          {#each filenameLabels as label (label.node.id)}
            <g class="note-name" role="button" tabindex={label.opacity > 0.05 ? 0 : -1} aria-hidden={label.opacity <= 0.01} pointer-events={label.opacity > 0.05 ? 'auto' : 'none'} data-filename-id={label.node.id} aria-label={`Read ${label.node.fileName || label.node.title}`}
              onmouseenter={() => hoveredId = label.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = label.node.id} onblur={() => hoveredId = null}
              onclick={() => pin(label.node)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pin(label.node); } }}>
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
  <button class="regions-toggle" aria-label={panelOpen ? 'Close Atlas info' : 'Show Atlas regions'} aria-expanded={panelOpen} onclick={() => { if (panelOpen) closeCard(); else panelOpen = true; }}>{panelOpen ? 'Close info' : 'Regions'}</button>
  {#if panelOpen}
  <aside class="dock" aria-label="Atlas info panel">
    {#if active}
      <article class="reader" onwheel={wheelCard} aria-label="Note reader">
        <div class="reader-heading"><span>Note</span><button onclick={closeCard} aria-label="Close note reader">×</button></div>
        <h2>{(active.node.fileName || active.node.title).replace(/\.md$/i, '')}</h2><p class="activity-detail">{activityText(active.node)}</p>
        <div class="browse"><span>{query.trim() ? 'Search matches' : 'Connected notes'}</span><div><button disabled={!pool.length} onclick={() => cycle(-1)} aria-label="Previous Atlas note">↑</button><span>{poolIndex >= 0 ? poolIndex + 1 : '–'} / {pool.length}</span><button disabled={!pool.length} onclick={() => cycle(1)} aria-label="Next Atlas note">↓</button></div></div>
        {#if fullText !== null}<div class="full-source" tabindex="0" role="textbox" aria-readonly="true" aria-label="Full note source">{fullText}</div>{:else}<div class="reader-excerpt">{excerptText(active.node.preview) || 'No excerpt available for this note.'}</div>{/if}
        <div class="reader-footer"><span>{eligibleLinks.filter((link) => link.sourceId === active.node.id || link.targetId === active.node.id).length} connections · scroll preview to browse</span><button disabled={readStatus === 'loading'} onclick={loadSource}>{readStatus === 'loading' ? 'Loading…' : fullText !== null ? 'Reload source' : 'Read full note'}</button>{#if readStatus === 'error'}<small>Could not load this note. Try again.</small>{/if}</div>
      </article>
    {/if}
    {#if !active}
      {#key inspectedRegionId}<section class="region-guide" aria-label="Region guide">
        {#if inspectedRegion}
          <div class="guide-heading"><strong>Notes in this region</strong><div><button onclick={() => { inspectedRegionId = null; reset(); }}>All regions</button><button onclick={closeCard} aria-label="Close region info">×</button></div></div>
          <label class="rename">Region name<input aria-label="Region name" value={inspectedRegion.name} oninput={(event) => regionNames = { ...regionNames, [inspectedRegion.cloud.id]: event.currentTarget.value }}/></label>
          <p class="region-count">{inspectedRegion.cloud.noteCount} notes · examples from this region</p>
          <div class="region-examples">{#each inspectedRegion.examples as node (node.id)}<button onclick={() => pin(node)}><strong>{node.title || node.fileName}</strong><span>{excerptText(node.preview).slice(0, 150)}</span></button>{/each}</div>
        {:else}
          <div class="guide-heading"><strong>Regions · {regions.length}</strong><button onclick={closeCard} aria-label="Close region info">×</button></div>
          <p class="guide-help">Example notes give each region context. Select a region to see more or rename it.</p>
          <div class="region-list">{#each regions as region (region.cloud.id)}<button onclick={() => inspectRegion(region.cloud.id)}><span><i style:background={region.color}></i><strong>{region.name}</strong><small>{region.cloud.noteCount}</small></span><p>{region.examples.slice(0, 2).map((node) => node.title || node.fileName).join(' · ') || 'No example notes available.'}</p></button>{/each}</div>
        {/if}
      </section>{/key}
    {/if}
  </aside>
  {/if}
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
  button:focus-visible,.full-source:focus-visible,input:focus-visible{outline:2px solid var(--color-ring);outline-offset:2px}
  .regions-toggle{position:absolute;right:20px;top:16px;z-index:10;padding:8px 13px;border:1px solid var(--color-border);border-radius:20px;background:color-mix(in srgb,var(--color-background) 90%,transparent);font-size:12px;backdrop-filter:blur(12px)}
  .dock{position:absolute;right:20px;top:60px;width:min(340px,calc(100% - 40px));height:min(560px,calc(100% - 170px));z-index:12;border:1px solid var(--color-border);border-radius:16px;background:color-mix(in srgb,var(--color-background) 94%,transparent);overflow:hidden;box-shadow:0 10px 35px #0003;backdrop-filter:blur(16px)}
  .reader{height:100%;display:flex;flex-direction:column;overflow:hidden;padding:18px}
  .reader-heading,.guide-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--color-muted-foreground)}
  .reader-heading button{font-size:22px;width:28px;height:28px}
  .reader h2{font-size:20px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;margin:10px 0 6px}
  .activity-detail{font-size:11px;line-height:1.5;color:var(--color-muted-foreground);margin:0 0 12px}
  .browse{display:flex;justify-content:space-between;align-items:center;gap:8px;border-block:1px solid var(--color-border);padding:9px 0;font-size:11px;color:var(--color-muted-foreground)}
  .browse>div{display:flex;gap:7px;align-items:center}.browse button{border:1px solid var(--color-border);border-radius:6px;width:30px;height:30px;font-size:15px}
  .reader-excerpt,.full-source{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;margin:12px 0;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
  .reader-footer{display:flex;flex-wrap:wrap;align-items:center;gap:9px;border-top:1px solid var(--color-border);padding-top:12px;color:var(--color-muted-foreground);font-size:10px}
  .reader-footer button,.guide-heading button{padding:7px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:11px;min-height:30px}
  .reader-heading,.reader h2,.activity-detail,.browse,.reader-footer{flex-shrink:0}
  .region-guide{height:100%;overflow:auto;padding:18px;overscroll-behavior:contain}
  .guide-heading{font-size:14px;color:var(--color-foreground)}.guide-heading>div{display:flex;gap:5px}
  .guide-help,.region-count{font-size:12px;line-height:1.6;color:var(--color-muted-foreground);margin:12px 0}
  .region-list{display:flex;flex-direction:column}.region-list>button{padding:12px 0;border-bottom:1px solid var(--color-border);text-align:left;width:100%}
  .region-list>button>span{display:flex;gap:8px;align-items:center;font-size:13px}.region-list i{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .region-list small{margin-left:auto;color:var(--color-muted-foreground);font-size:11px}
  .region-list p{font-size:11px;line-height:1.6;color:var(--color-muted-foreground);margin:6px 0 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
  .rename{display:flex;flex-direction:column;gap:6px;margin-top:16px;font-size:11px;color:var(--color-muted-foreground)}
  .rename input{width:100%;font-size:15px;color:var(--color-foreground);background:transparent;border:1px solid var(--color-border);border-radius:6px;padding:8px}
  .region-examples{display:flex;flex-direction:column}.region-examples button{padding:12px 0;border-bottom:1px solid var(--color-border);text-align:left}
  .region-examples strong{display:block;font-size:13px;font-weight:550}.region-examples span{display:block;font-size:12px;line-height:1.6;color:var(--color-muted-foreground);margin-top:6px}
  .hover-preview{position:absolute;width:208px;max-height:88px;overflow:hidden;pointer-events:none;z-index:4;background:color-mix(in srgb,var(--color-background) 97%,transparent);border:1px solid var(--color-border);border-radius:6px;padding:8px;box-shadow:0 4px 13px #00000012}
  .hover-preview strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:600}.hover-preview p{font-size:9px;line-height:1.5;color:var(--color-muted-foreground);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;margin:4px 0}.hover-preview>span{font-size:8px;color:var(--color-muted-foreground)}
  @container(max-width:450px){.regions-toggle{right:12px;top:12px}.dock{inset:auto 12px 100px;width:auto;height:min(52%,460px);border-radius:14px}.reader,.region-guide{padding:14px}.reader h2{font-size:17px;margin:5px 0}.activity-detail{margin-bottom:7px}.browse{padding:6px 0}.reader-excerpt,.full-source{margin:8px 0}.reader-footer{padding-top:8px}}
</style>
