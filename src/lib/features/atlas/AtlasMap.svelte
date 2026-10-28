<script lang="ts">
  import { keyboardShortcutMatchesEvent } from '#lib/keyboardShortcuts.svelte.js';

  import { noteFileLabel } from '#lib/noteLabels.js';
  // Topic geography with spaced dots and zoom-faded filenames.
  import { onMount, untrack, type Snippet } from 'svelte';
  import { interpolateAtlas, atlasGeometryMoved, type AtlasGeometry } from './atlasMotion';
  import { ChevronDown } from '@lucide/svelte';
  import type { AtlasNode, AtlasLink, VaultAtlasResponse } from '#lib/types/atlas.js';
  import { daysAgo } from './atlasActivity';
  import { createAtlasLayout, noteTitle, labelWorldSize, nodeWorldRadius, nodeConnectedness, type Point } from './atlasLayout';
  import { createAtlasConnections } from './atlasConnections';
  import { createAtlasRouting } from './atlasRouting';
  type Props = {
    response: VaultAtlasResponse;
    query: string;
    selectedNodeId: string | null;
    selectNode: (node: AtlasNode | null) => void;
    matchingIds: ReadonlySet<string>;
    openNode: (node: AtlasNode) => Promise<void>;
    readSource: (node: AtlasNode) => Promise<string>;
    renameCloud?: (id: string, name: string | null) => Promise<void>;
    search: Snippet<[() => void]>;
  };
  let { response, query, selectedNodeId, selectNode, matchingIds, openNode, readSource, renameCloud, search }: Props = $props();
  let inspectedRegionId = $state<string | null>(null);
  let workbenchElement = $state<HTMLDivElement | null>(null);
  let activeId = $derived(selectedNodeId);
  let browseOriginId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let hoveredRegionId = $state<string | null>(null);
  let focusedRegionId = $state<string | null>(null);
  let zoom = $state(1), panX = $state(0), panY = $state(0);
  const labelZoom = 0.55;
  let panelOpen = $state(false);
  let minimumStrength = $state<number | null>(null);
  let curvedConnections = $state(true);
  let plotElement = $state<HTMLDivElement | null>(null);
  let svgElement: SVGSVGElement;
  let width = $state(1000), height = $state(560);
  let drag = $state<{ id: number; x: number; y: number; originalX: number; originalY: number } | null>(null);
  let fullText = $state<string | null>(null);
  let readStatus = $state<'idle' | 'loading' | 'error'>('idle');
  let readSequence = 0, wheelTime = 0;
  let sourceSignature = '';
  let zoomFrame = 0, pendingZoomDelta = 0;
  let focusFrame = 0;
  let pendingZoomPoint: Point | null = null;
  let hasPlotSize = $state(false), hasFramed = false;
  let cameraCenter = $state<Point>({ x: 0, y: 0 });
  const layout = createAtlasLayout();
  const routeConnections = createAtlasRouting();
  let targetGeometry = $derived(layout(response));
  let displayedGeometry = $state.raw<AtlasGeometry | null>(null);
  let isMorphing = $state(false);
  let geometry = $derived(displayedGeometry ?? targetGeometry);
  let morphFrame = 0;
  $effect(() => {
    const target = targetGeometry;
    const from = untrack(() => displayedGeometry);
    if (morphFrame) cancelAnimationFrame(morphFrame);
    if (!from || !atlasGeometryMoved(from, target) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayedGeometry = target; isMorphing = false;
      return;
    }
    const started = performance.now();
    let prior = from;
    displayedGeometry = interpolateAtlas(from, target, 0);
    isMorphing = true;
    function frame(now: number) {
      const t = Math.min(1, (now-started)/450);
      const next = interpolateAtlas(from!, target, 1-Math.pow(1-t,3));
      if (inspectedRegionId && !drag && !pinch && !focusFrame) {
        const before = prior.clouds.find(item => item.cloud.id === inspectedRegionId);
        const after = next.clouds.find(item => item.cloud.id === inspectedRegionId);
        if (before && after) { panX -= (after.center.x-before.center.x)*zoom; panY -= (after.center.y-before.center.y)*zoom; }
      }
      displayedGeometry = next; prior = next;
      isMorphing = t < 1;
      morphFrame = t < 1 ? requestAnimationFrame(frame) : 0;
    }
    morphFrame = requestAnimationFrame(frame);
    return () => { if (morphFrame) cancelAnimationFrame(morphFrame); morphFrame = 0; };
  });
  let visibleNodes = $derived(geometry.nodes.filter(mark => !query.trim() || matchingIds.has(mark.node.id)));
  let byId = $derived(new Map(geometry.nodes.map((mark) => [mark.node.id, mark])));
  let active = $derived(byId.get(activeId ?? ''));
  let origin = $derived(byId.get(browseOriginId ?? activeId ?? ''));
  let matching = $derived([...matchingIds].map(id => byId.get(id)?.node).filter((node): node is AtlasNode => !!node));
  let connections = $derived(createAtlasConnections(response));
  let connectedNotes = $derived(origin ? [origin.node, ...connections(origin.node.id, minimumStrength).links.map(link =>
    byId.get(link.sourceId === origin.node.id ? link.targetId : link.sourceId)?.node).filter((node): node is AtlasNode => !!node)] : []);
  let pool = $derived(query.trim() ? matching : connectedNotes);
  let poolIndex = $derived(pool.findIndex((node) => node.id === activeId));
  // A pinned note owns the neighborhood until closed or another note is chosen.
  let focusId = $derived(activeId ?? hoveredId);
  let neighborhood = $derived(connections(focusId, minimumStrength));
  let relatedNodeIds = $derived(new Set([...(focusId ? [focusId] : []), ...neighborhood.links.flatMap((link) => [link.sourceId, link.targetId])]));
  // Quiet overview; exploring a note reveals its connections without a permanent web of edges.
  let links = $derived(neighborhood.links.filter(link => !query.trim() || (matchingIds.has(link.sourceId) && matchingIds.has(link.targetId))));
  let routed = $derived(curvedConnections && !isMorphing ? routeConnections(targetGeometry, links, focusId) : { paths: new Map(), trunks: [] });
  // Spaced geography stays fixed; camera and label visibility never repack it.

  let graphClouds = $derived(geometry.clouds.filter(item => item.points.length).toSorted((a, b) => a.cloud.level - b.cloud.level));
  let captionClouds = $derived(graphClouds.filter(item => !item.cloud.parentId || zoom >= labelZoom || item.cloud.id === inspectedRegionId));
  let familyRegions = $derived.by(() => {
    const families = new Map<string, typeof geometry.clouds>();
    for (const cloud of geometry.clouds) {
      if (cloud.cloud.parentId || !cloud.cloud.familyId) continue;
      const siblings = families.get(cloud.cloud.familyId) ?? [];
      siblings.push(cloud); families.set(cloud.cloud.familyId, siblings);
    }
    return [...families].flatMap(([id, children]) => {
      const parent = geometry.clouds.find(item => item.cloud.id === id);
      const members = parent ? [...children,parent] : children;
      if (members.length < 2) return [];
      const points = members.flatMap(item => item.points);
      const left = Math.min(...points.map(p=>p.x))-30, right = Math.max(...points.map(p=>p.x))+30;
      const top = Math.min(...points.map(p=>p.y))-30, bottom = Math.max(...points.map(p=>p.y))+30;
      return [{id,name:parent?.cloud.label ?? children[0].cloud.familyName ?? 'Related themes',x:(left+right)/2,y:(top+bottom)/2,rx:(right-left)/2,ry:(bottom-top)/2,top}];
    });
  });
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
  // Published Atlas centrality includes weighted explicit and similarity links.
  // Size expresses connectedness, independently of opening activity.
  const dotRadius = (id: string) => nodeWorldRadius(byId.get(id)!.node);
  // Keep relative sizes visible at overview, then scale linearly with the map.
  const visibleRadius = (id: string) => Math.max(2 + 1.5 * nodeConnectedness(byId.get(id)!.node), dotRadius(id) * cameraScale);
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
    if (query.trim()) return 1;
    if (activeId) return relatedNodeIds.has(node.id) ? 0.9 : 0.18;
    // Unknown or old activity remains clearly visible; it does not mean never read.
    return 0.6 + 0.3 * attention(node);
  }
  let labelOpacity = $derived.by(() => {
    const value = Math.max(0, Math.min(1, (cameraScale - labelZoom * 0.55) / (labelZoom * 0.65)));
    return value * value * (3 - 2 * value);
  });
  // Names live in world coordinates: one camera transform scales the entire
  // layer, even when overview names are fully faded out. No per-frame title work.
  let filenameLabels = $derived(visibleNodes.filter((mark) => !!query.trim() || !activeId || relatedNodeIds.has(mark.node.id)).map((mark) => ({
    ...mark, title: noteTitle(mark.node),
    labelY: mark.y + dotRadius(mark.node.id) + labelWorldSize + 3
  })));
  let filenameOpacity = $derived(activeId ? 1 : labelOpacity);
  let labelsInteractive = $derived(filenameOpacity > 0.05);
  function dotConnection(link: AtlasLink) {
    const a = byId.get(link.sourceId)!, b = byId.get(link.targetId)!;
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
    if (distance < 0.001) return '';
    const start = Math.min(visibleRadius(a.node.id) / cameraScale, distance / 2), end = Math.min(visibleRadius(b.node.id) / cameraScale, distance / 2);
    return `M${a.x + dx / distance * start},${a.y + dy / distance * start}L${b.x - dx / distance * end},${b.y - dy / distance * end}`;
  }
  const regionName = (fallback: string | null) => fallback || 'Unlabelled region';
  let regions = $derived(geometry.clouds.map((item) => ({
    ...item, name: regionName(item.cloud.label),
    examples: item.cloud.representativeNodeIds.map((id) => byId.get(id)?.node).filter((node): node is AtlasNode => !!node)
  })));
  let inspectedRegion = $derived(regions.find((item) => item.cloud.id === inspectedRegionId));
  let namingRegionId = $state<string | null>(null);
  let nameDraft = $state('');
  let nameSaving = $state(false);
  let nameError = $state('');
  async function saveRegionName(automatic = false) {
    const id = namingRegionId ?? inspectedRegionId;
    if (!id || !renameCloud || nameSaving) return;
    nameSaving = true; nameError = '';
    try { await renameCloud(id, automatic ? null : nameDraft); if (inspectedRegionId === id) namingRegionId = null; }
    catch (error) { if (inspectedRegionId === id) nameError = String(error); }
    finally { nameSaving = false; }
  }

  let previewRegionId = $derived(panelOpen && !active && !inspectedRegionId ? hoveredRegionId ?? focusedRegionId : null);
  function clickRegion(id: string) { if (performance.now() >= ignoreClickUntil) inspectRegion(id); }
  function inspectRegion(id: string) {
    closeCard(); namingRegionId = null; nameError = ''; inspectedRegionId = id; panelOpen = true;
    const region = geometry.clouds.find((item) => item.cloud.id === id);
    if (!region) return;
    const x = (Math.min(...region.points.map((point) => point.x)) + Math.max(...region.points.map((point) => point.x))) / 2;
    const y = (Math.min(...region.points.map((point) => point.y)) + Math.max(...region.points.map((point) => point.y))) / 2;
    const nextZoom = Math.max(0.75, Math.min(1.5, Math.min((width - 48) / Math.max(1, Math.max(...region.points.map((point) => point.x)) - Math.min(...region.points.map((point) => point.x))), (height - 48) / Math.max(1, Math.max(...region.points.map((point) => point.y)) - Math.min(...region.points.map((point) => point.y))))));
    focusCamera({ x, y }, nextZoom);
  }
  function cancelFocus() {
    if (focusFrame) cancelAnimationFrame(focusFrame);
    focusFrame = 0;
  }
  function focusCamera(center: Point, nextZoom: number) {
    clearZoomQueue(); cancelFocus();
    const startZoom = zoom;
    const startCenter = { x: cameraCenter.x - panX / zoom, y: cameraCenter.y - panY / zoom };
    function apply(progress: number) {
      // Interpolate the visible world center and scale together, keeping the
      // destination steady as the camera eases into the cloud.
      zoom = progress === 1 ? nextZoom : startZoom * Math.pow(nextZoom / startZoom, progress);
      panX = (cameraCenter.x - (startCenter.x + (center.x - startCenter.x) * progress)) * zoom;
      panY = (cameraCenter.y - (startCenter.y + (center.y - startCenter.y) * progress)) * zoom;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(1); return; }
    const started = performance.now();
    function step(now: number) {
      const progress = Math.min(1, (now - started) / 300);
      apply(1 - Math.pow(1 - progress, 3));
      focusFrame = progress < 1 ? requestAnimationFrame(step) : 0;
    }
    focusFrame = requestAnimationFrame(step);
  }
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
    const target = event.target as HTMLElement;
    const reader = event.currentTarget as HTMLElement;
    const excerpt = target.closest<HTMLElement>('.reader-excerpt');
    // Scrolling a constrained reader must not replace the note being read.
    if (target.closest('.full-source') || reader.scrollHeight > reader.clientHeight + 1 ||
        (excerpt && excerpt.scrollHeight > excerpt.clientHeight + 1)) {
      event.stopPropagation(); return;
    }
    event.preventDefault(); event.stopPropagation();
    if (performance.now() - wheelTime < 135 || Math.abs(event.deltaY) < 3) return;
    wheelTime = performance.now(); cycle(event.deltaY > 0 ? 1 : -1);
  }
  function keyNode(event: KeyboardEvent, node: AtlasNode) {
    if (event.defaultPrevented) return;
    if (keyboardShortcutMatchesEvent(event, 'mapOpen')) {
      event.preventDefault(); event.stopPropagation(); void openNode(node);
    } else if (keyboardShortcutMatchesEvent(event, 'mapPreview')) {
      event.preventDefault(); event.stopPropagation(); pin(node);
    }
  }
  function keyBrowse(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const element = event.target as HTMLElement;
    if (element.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (keyboardShortcutMatchesEvent(event, 'mapDismiss')) { closeCard(); return; }
    if (element.closest('.full-source')) return;
    if (element !== document.body && !workbenchElement?.contains(element)) return;
    if (element.closest('button')) return;
    if (keyboardShortcutMatchesEvent(event, 'mapOpen') && active) { event.preventDefault(); void openNode(active.node); return; }
    if (keyboardShortcutMatchesEvent(event, 'mapReset')) { event.preventDefault(); reset(); return; }
    if (keyboardShortcutMatchesEvent(event, 'mapZoomIn') || keyboardShortcutMatchesEvent(event, 'mapZoomOut')) { event.preventDefault(); setZoomAt(zoom * Math.exp(keyboardShortcutMatchesEvent(event, 'mapZoomOut') ? -0.2 : 0.2), { x: width / 2, y: height / 2 }); return; }
    if (active && (keyboardShortcutMatchesEvent(event, 'mapNext') || keyboardShortcutMatchesEvent(event, 'mapPrevious'))) { event.preventDefault(); cycle(keyboardShortcutMatchesEvent(event, 'mapNext') ? 1 : -1); }
  }
  async function loadSource() {
    if (!active || !readSource) return;
    const id = active.node.id, sequence = ++readSequence;
    readStatus = 'loading';
    try { const text = await readSource(active.node); if (sequence === readSequence && activeId === id) { fullText = text; readStatus = 'idle'; } }
    catch { if (sequence === readSequence && activeId === id) readStatus = 'error'; }
  }
  function clearSelection() { hoveredId = null; browseOriginId = null; selectNode(null); fullText = null; readStatus = 'idle'; readSequence++; }
  function closeCard() { panelOpen = false; hoveredRegionId = null; focusedRegionId = null; clearSelection(); }
  function clickCanvas(event: MouseEvent) {
    if (event.button !== 0 || performance.now() < ignoreClickUntil || (event.target as Element).closest('[role="button"]')) return;
    clearSelection();
  }
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
    if (event.button !== 0) return;
    cancelFocus(); clearZoomQueue();
    // Cancel native mouse text selection without suppressing touch tap clicks.
    if (event.pointerType !== 'touch') {
      event.preventDefault();
      (event.target as Element).closest<SVGElement>('[role="button"]')?.focus({ preventScroll: true });
    }
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
    cancelFocus();
    next = Math.max(Math.min(0.04, fitScale * 0.5), Math.min(12, next));
    if (next === zoom) return;
    const ratio = next / zoom; panX = point.x - width / 2 - (point.x - width / 2 - panX) * ratio; panY = point.y - height / 2 - (point.y - height / 2 - panY) * ratio; zoom = next;
  }
  function clearZoomQueue() {
    if (zoomFrame) cancelAnimationFrame(zoomFrame);
    zoomFrame = 0; pendingZoomDelta = 0; pendingZoomPoint = null;
  }
  function zoomAt(event: WheelEvent) {
    event.preventDefault();
    if (!event.deltaY || !Number.isFinite(event.deltaY)) return;
    cancelFocus();
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
  function reset() { clearZoomQueue(); cancelFocus(); cameraCenter = worldBounds.center; zoom = fitScale; panX = 0; panY = 0; }
  $effect(() => {
    if (hasPlotSize && response.nodes.length && !hasFramed) { hasFramed = true; reset(); }
  });
  $effect(() => {
    const ids = new Set(response.nodes.map(node => node.id));
    if (browseOriginId && !ids.has(browseOriginId)) browseOriginId = null;
    if (hoveredId && !ids.has(hoveredId)) hoveredId = null;
    if (inspectedRegionId && !response.clouds.some(cloud => cloud.id === inspectedRegionId)) inspectedRegionId = null;
    if (hoveredRegionId && !regions.some(region => region.cloud.id === hoveredRegionId)) hoveredRegionId = null;
    if (focusedRegionId && !regions.some(region => region.cloud.id === focusedRegionId)) focusedRegionId = null;
    // A refreshed excerpt/path invalidates the previously read source, including in-flight reads.
    const signature = active ? `${active.node.id}:${active.node.notePath}:${active.node.updatedAtMillis}:${active.node.preview}` : '';
    if (signature !== sourceSignature) { sourceSignature = signature; fullText = null; readStatus = 'idle'; readSequence++; if (active) panelOpen = true; }
  });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) { width = entry.contentRect.width; height = entry.contentRect.height; hasPlotSize = true; } });
    const plot = plotElement;
    if (plot) {
      observer.observe(plot);
      // Avoid relying on WebKit's wheel hit testing over unpainted SVG space.
      // Register on the full HTML surface, including the gaps between clouds.
      plot.addEventListener('wheel', zoomAt, { passive: false });
      // Background clicks share the full hit surface; Escape already provides
      // keyboard dismissal. Interactive SVG controls keep their own actions.
      plot.addEventListener('click', clickCanvas);
    }
    return () => { observer.disconnect(); plot?.removeEventListener('wheel', zoomAt); plot?.removeEventListener('click', clickCanvas); clearZoomQueue(); cancelFocus(); };
  });
</script>

<svelte:window onkeydown={keyBrowse}/>
<section class="atlas-map" aria-label="Atlas map" data-map-revision={response.revision} data-map-moving={isMorphing}>
  <div class="workbench" bind:this={workbenchElement}>
  <div class="plot" bind:this={plotElement}>
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Atlas dot map with ${visibleNodes.length} of ${response.nodes.length} notes`} onpointerdown={startPan} onpointermove={movePan} onpointerup={stopPan} onpointercancel={stopPan}>
      <defs><clipPath id="atlas-map-clip"><rect width={width} height={height}/></clipPath></defs>
      <rect class="map-background" width={width} height={height} fill="transparent" pointer-events="all" aria-hidden="true"/>
      <g clip-path="url(#atlas-map-clip)">
        <g class="map-world" transform={`translate(${width / 2 + panX} ${height / 2 + panY}) scale(${cameraScale}) translate(${-cameraCenter.x} ${-cameraCenter.y})`}>
          {#if zoom < labelZoom}<g class="map-families" pointer-events="none" aria-hidden="true">{#each familyRegions as family (family.id)}
            <ellipse data-family-id={family.id} cx={family.x} cy={family.y} rx={family.rx} ry={family.ry} fill="none" stroke="var(--color-muted-foreground)" stroke-opacity="0.2" stroke-dasharray="8 8" />
            <text x={family.x} y={family.top-8} text-anchor="middle" font-size="18" fill="var(--color-muted-foreground)">{family.name}</text>
          {/each}</g>{/if}
          {#each graphClouds as item (item.cloud.id)}
            {@const parent = item.cloud.childCloudIds.length > 0}
            {@const quietChild = !!item.cloud.parentId && zoom < labelZoom && item.cloud.id !== inspectedRegionId}
            <g class="cloud-shape" class:region-highlighted={item.cloud.id === previewRegionId} role="button" tabindex="0" data-region-id={item.cloud.id} aria-label={`Explore region ${regionName(item.cloud.label)}`} onclick={() => clickRegion(item.cloud.id)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); inspectRegion(item.cloud.id); } }}>
              <polygon data-cloud-id={item.cloud.id} points={item.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={item.color} fill-opacity={parent ? 0.05 : quietChild ? 0.04 : 0.1} stroke={item.color} stroke-opacity={parent ? 0.32 : quietChild ? 0.36 : 0.5} stroke-width={parent || quietChild ? 1.2 : 1.5}/>
            </g>
          {/each}
          <g class="tile-highways" pointer-events="none" aria-hidden="true">{#each routed.trunks as trunk (trunk.id)}
            <path data-trunk-id={trunk.id} d={trunk.path} fill="none" stroke={trunk.kind === 'wikilink' ? 'var(--color-foreground)' : 'color-mix(in srgb, #967aa9 65%, var(--color-foreground))'} vector-effect="non-scaling-stroke" stroke-width="1.5" stroke-dasharray={trunk.kind === 'semantic' ? '6 5' : 'none'} opacity="0.75"/>
          {/each}</g>
          <g class="tile-links" pointer-events="none">{#each links as link (link.id)}
            {@const emphasized = !!hoveredId && hoveredId !== focusId && (link.sourceId === hoveredId || link.targetId === hoveredId)}
            {@const route = routed.paths.get(link.id)}
            <path data-full-path={curvedConnections ? route?.path : undefined} data-trunk-id={route?.trunkId} data-link-source={link.sourceId} data-link-target={link.targetId} d={curvedConnections && !isMorphing ? (emphasized ? route?.path : route?.branch) : dotConnection(link)} fill="none" stroke={link.kind === 'wikilink' ? 'var(--color-foreground)' : 'color-mix(in srgb, #967aa9 65%, var(--color-foreground))'} vector-effect="non-scaling-stroke" stroke-width={emphasized ? 2.4 : 1.5} stroke-dasharray={link.kind === 'semantic' ? '6 5' : 'none'} opacity={emphasized ? 1 : 0.75}/>
          {/each}</g>
          <g class="graph-dots">
            {#each visibleNodes as mark (mark.node.id)}
              <g class="note-dot" role="button" tabindex="0" data-node-id={mark.node.id} data-root-id={mark.rootId} aria-label={`Pin ${noteFileLabel(mark.node.fileName || mark.node.title, mark.node.noteId)}`}
                onmouseenter={() => hoveredId = mark.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = mark.node.id} onblur={() => hoveredId = null}
                onclick={() => clickNode(mark.node)} ondblclick={() => void openNode(mark.node)} onkeydown={(event) => keyNode(event, mark.node)}>
                <circle class="dot-hit" cx={mark.x} cy={mark.y} r={Math.max(visibleRadius(mark.node.id), 8) / cameraScale} fill="transparent"/>
                <circle class="dot-body" cx={mark.x} cy={mark.y} r={visibleRadius(mark.node.id) / cameraScale} fill={mark.color} fill-opacity={dotOpacity(mark.node)} data-connectedness={nodeConnectedness(mark.node)} data-attention={attention(mark.node)} stroke={focusId === mark.node.id ? 'var(--color-foreground)' : 'none'} stroke-width="1.5" vector-effect="non-scaling-stroke"/>
              </g>
            {/each}
          </g>
          {#each captionClouds as item (item.cloud.id)}
            <g class="region-caption" class:region-highlighted={item.cloud.id === previewRegionId} pointer-events="none" aria-hidden="true">
              <text x={item.labelPoint.x} y={item.labelPoint.y} text-anchor="middle" font-size={item.labelFontSize} font-weight="550" fill="var(--color-muted-foreground)">{regionName(item.cloud.label).slice(0, 32)}</text>
            </g>
          {/each}
          <g class="filename-labels" opacity={filenameOpacity} pointer-events={labelsInteractive ? 'auto' : 'none'} aria-hidden={filenameOpacity <= 0.01}>
            {#each filenameLabels as label (label.node.id)}
              <g class="note-name" role="button" tabindex={labelsInteractive ? 0 : -1} data-filename-id={label.node.id} aria-label={`Read ${noteFileLabel(label.node.fileName || label.node.title, label.node.noteId)}`}
                onmouseenter={() => hoveredId = label.node.id} onmouseleave={() => hoveredId = null} onfocus={() => hoveredId = label.node.id} onblur={() => hoveredId = null}
                onclick={() => clickNode(label.node)} ondblclick={() => void openNode(label.node)} onkeydown={(event) => keyNode(event, label.node)}>
                <text x={label.x} y={label.labelY} text-anchor="middle" font-size={labelWorldSize} font-weight={activeId === label.node.id ? '600' : '400'} fill="var(--color-foreground)" stroke="var(--color-background)" stroke-width="0.8" stroke-linejoin="round" paint-order="stroke">{label.title}</text>
              </g>
            {/each}
          </g>
        </g>
      </g>
      {#if !response.nodes.length}<text x={width / 2} y={height / 2} text-anchor="middle" fill="var(--color-muted-foreground)">No notes in this snapshot.</text>{/if}
    </svg>
  </div>
  <aside class="dock" class:dock-open={panelOpen} aria-label="Atlas info">
    <button class="regions-toggle" aria-label={panelOpen ? 'Collapse Atlas info' : 'Show Atlas regions'} aria-expanded={panelOpen} aria-controls="atlas-info-body" onclick={() => { if (panelOpen) closeCard(); else panelOpen = true; }}>
      <span>{active ? 'Note' : 'Regions'}</span><ChevronDown class="info-chevron" />
    </button>
    {#if panelOpen}
    <div class="info-body" id="atlas-info-body">
      <div class="connection-control">
        <div class="strength-heading"><label for="atlas-connection-strength">Minimum suggested strength</label><output for="atlas-connection-strength">{neighborhood.threshold.toFixed(2)}</output><button disabled={minimumStrength === null} onclick={() => minimumStrength = null} aria-label="Use automatic connection strength">Auto</button></div>
        <input id="atlas-connection-strength" type="range" min="0" max="1" step="0.01" value={neighborhood.threshold} oninput={(event) => minimumStrength = event.currentTarget.valueAsNumber} aria-describedby="atlas-strength-help" />
        <p id="atlas-strength-help">Lower shows more suggestions. Explicit links always show.</p>
        <label class="routing-toggle"><input type="checkbox" bind:checked={curvedConnections} />Route connections around clouds</label>
      </div>
    {#if active}
      <article class="reader" onwheel={wheelCard} aria-label="Note reader">
        <h2>{noteFileLabel(active.node.fileName || active.node.title, active.node.noteId).replace(/\.md$/i, '')}</h2><p class="activity-detail">{activityText(active.node)}</p>
        <div class="browse"><span>{query.trim() ? 'Search matches' : 'Connected notes'}</span><div><button disabled={!pool.length} onclick={() => cycle(-1)} aria-label="Previous Atlas note">↑</button><span>{poolIndex >= 0 ? poolIndex + 1 : '–'} / {pool.length}</span><button disabled={!pool.length} onclick={() => cycle(1)} aria-label="Next Atlas note">↓</button></div></div>
        {#if fullText !== null}<div class="full-source" tabindex="0" role="textbox" aria-readonly="true" aria-label="Full note source">{fullText}</div>{:else}<div class="reader-excerpt">{excerptText(active.node.preview) || 'No excerpt available for this note.'}</div>{/if}
        <div class="reader-footer"><span>{links.length} of {neighborhood.total} connections shown · scroll preview to browse</span><button onclick={() => active && void openNode(active.node)}>Open in editor</button><button disabled={readStatus === 'loading'} onclick={loadSource}>{readStatus === 'loading' ? 'Loading…' : fullText !== null ? 'Reload source' : 'Read full note'}</button>{#if readStatus === 'error'}<small>Could not load this note. Try again.</small>{/if}</div>
      </article>
    {/if}
    {#if !active}
      {#key inspectedRegionId}<section class="region-guide" aria-label="Region guide">
        {#if inspectedRegion}
          <div class="guide-heading"><strong>Notes in this region</strong><div><button onclick={() => { inspectedRegionId = null; reset(); }}>All regions</button></div></div>
          <h2 class="region-name">{inspectedRegion.name}</h2>
          {#if renameCloud}
            {#if namingRegionId === inspectedRegionId}
              <form class="region-naming" onsubmit={(event) => { event.preventDefault(); void saveRegionName(); }}>
                <label for="atlas-region-name">Cloud name</label>
                <input id="atlas-region-name" bind:value={nameDraft} disabled={nameSaving} onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); namingRegionId = null; nameError = ''; } }} />
                <div><button type="submit" disabled={nameSaving}>{nameSaving ? 'Saving…' : 'Save name'}</button><button type="button" disabled={nameSaving} onclick={() => { namingRegionId = null; nameError = ''; }}>Cancel</button></div>
              </form>
            {:else}
              <div class="region-name-actions"><button onclick={() => { nameDraft = inspectedRegion!.name; namingRegionId = inspectedRegionId; nameError = ''; }}>Name cloud</button>
                {#if inspectedRegion.cloud.userName}<button disabled={nameSaving} onclick={() => void saveRegionName(true)}>Use automatic name</button>{/if}
              </div>
            {/if}
            {#if nameError}<p class="name-error" role="alert">{nameError}</p>{/if}
          {/if}
          {#if inspectedRegion.cloud.parentId}<p class="region-family">Part of {regions.find(region => region.cloud.id === inspectedRegion!.cloud.parentId)?.name ?? 'a broader region'}</p>{:else if inspectedRegion.cloud.familyId}<p class="region-family">Branched from {inspectedRegion.cloud.familyName ?? regions.find(region => region.cloud.id === inspectedRegion!.cloud.familyId)?.name ?? 'a related region'}</p>{/if}
          {#if inspectedRegion.cloud.childCloudIds.length}<div class="region-children" aria-label="Subthemes">{#each inspectedRegion.cloud.childCloudIds as id}{@const child = regions.find(region => region.cloud.id === id)}{#if child}<button onclick={() => inspectRegion(id)}>{child.name}</button>{/if}{/each}</div>{/if}
          <p class="region-count">{inspectedRegion.cloud.noteCount} notes · examples from this region</p>
          <div class="region-examples">{#each inspectedRegion.examples as node (node.id)}<button onclick={() => pin(node)}><strong>{noteFileLabel(node.title || node.fileName, node.noteId)}</strong><span>{excerptText(node.preview).slice(0, 150)}</span></button>{/each}</div>
        {:else}
          <div class="guide-heading"><strong>Regions · {regions.length}</strong></div>
          <p class="guide-help">Larger dots have stronger or more Atlas connections. Brighter dots have more recent opening activity; dimmer notes remain available to rediscover.</p>
          <div class="region-list">{#each regions.filter(region => !region.cloud.parentId || zoom >= labelZoom) as region (region.cloud.id)}<button data-region-id={region.cloud.id} onmouseenter={() => hoveredRegionId = region.cloud.id} onmouseleave={() => hoveredRegionId = null} onfocus={() => focusedRegionId = region.cloud.id} onblur={() => focusedRegionId = null} onclick={() => inspectRegion(region.cloud.id)}><span><i style:background={region.color}></i><strong>{region.name}</strong><small>{region.cloud.noteCount}</small></span><p>{region.examples.slice(0, 2).map((node) => noteFileLabel(node.title || node.fileName, node.noteId)).join(' · ') || 'No example notes available.'}</p></button>{/each}</div>
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
  .region-naming{display:grid;gap:6px;margin:10px 0;font-size:12px}
  .region-naming input{width:100%;border:1px solid var(--color-border);border-radius:6px;padding:6px;background:var(--color-background)}
  .region-naming div,.region-name-actions,.region-children{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
  .region-name-actions button,.region-naming button,.region-children button{font-size:11px;border:1px solid var(--color-border);border-radius:6px;padding:4px 7px}
  .region-family{font-size:11px;color:var(--color-muted-foreground)}
  .name-error{font-size:12px;color:var(--color-destructive)}
  .atlas-map{container-type:inline-size;position:relative;height:100%;width:100%;min-height:0;color:var(--color-foreground)}
  .workbench{position:absolute;inset:0;overflow:hidden}
  .plot{position:absolute;inset:0;overflow:hidden;background:var(--color-background)}
  .plot,.plot :global(*){-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  svg{width:100%;height:100%;touch-action:none;cursor:grab}svg:active{cursor:grabbing}
  svg g[role=button]{cursor:pointer;outline:none}svg g[role=button]:focus-visible>.dot-body,.note-dot:hover>.dot-body{stroke:var(--color-foreground);stroke-width:2px}
  .cloud-shape.region-highlighted>polygon{fill-opacity:.24;stroke-opacity:1;stroke-width:2.5px;vector-effect:non-scaling-stroke}
  .region-caption.region-highlighted>text{fill:var(--color-foreground);font-weight:700}
  .cloud-shape:focus-visible>polygon{stroke:var(--color-ring);stroke-opacity:1;stroke-width:2px}
  .note-name:focus-visible>text{fill:var(--color-ring)}
  button{cursor:pointer;color:var(--color-foreground)}button:disabled{opacity:.4;cursor:default}
  button:focus-visible,.full-source:focus-visible{outline:2px solid var(--color-ring);outline-offset:2px}
  .dock{position:absolute;right:20px;top:16px;width:110px;height:40px;z-index:12;border:1px solid var(--color-border);border-radius:20px;background:color-mix(in srgb,var(--color-background) 94%,transparent);overflow:hidden;backdrop-filter:blur(16px);transform-origin:top right;transition:width 220ms cubic-bezier(.2,.8,.2,1),height 220ms cubic-bezier(.2,.8,.2,1),border-radius 220ms,box-shadow 220ms}
  .dock-open{width:min(340px,calc(100% - 40px));height:min(560px,calc(100% - 140px));border-radius:16px;box-shadow:0 10px 35px #0003}
  .regions-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:39px;padding:8px 13px;font-size:12px;text-align:left}
  .regions-toggle:hover{background:var(--color-accent)}
  .regions-toggle :global(.info-chevron){width:14px;height:14px;flex-shrink:0;transition:transform 220ms}
  .dock-open .regions-toggle :global(.info-chevron){transform:rotate(180deg)}
  .info-body{height:calc(100% - 39px);display:flex;flex-direction:column;overflow:hidden;animation:info-reveal 180ms ease both}
  .connection-control{flex-shrink:0;padding:12px 18px;border-block:1px solid var(--color-border)}
  .strength-heading{display:flex;align-items:center;gap:8px;font-size:11px}.strength-heading label{flex:1}.strength-heading output{font-variant-numeric:tabular-nums;color:var(--color-muted-foreground)}
  .strength-heading button{border:1px solid var(--color-border);border-radius:5px;padding:3px 6px;font-size:10px}
  .connection-control input[type=range]{display:block;width:100%;margin:9px 0;accent-color:var(--color-ring);cursor:pointer}.connection-control input:focus-visible{outline:2px solid var(--color-ring);outline-offset:3px}
  .routing-toggle{display:flex;gap:7px;align-items:center;font-size:11px;margin-top:10px;cursor:pointer}.routing-toggle input{accent-color:var(--color-ring);cursor:pointer}
  .connection-control p{font-size:10px;color:var(--color-muted-foreground);margin:0;line-height:1.5}
  @keyframes info-reveal{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
  @media(prefers-reduced-motion:reduce){.dock,.regions-toggle :global(.info-chevron){transition:none}.info-body{animation:none}}
  .reader{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto;overscroll-behavior:contain;padding:18px}
  .guide-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--color-muted-foreground)}
  .reader h2{font-size:20px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;margin:10px 0 6px}
  .activity-detail{font-size:11px;line-height:1.5;color:var(--color-muted-foreground);margin:0 0 12px}
  .browse{display:flex;justify-content:space-between;align-items:center;gap:8px;border-block:1px solid var(--color-border);padding:9px 0;font-size:11px;color:var(--color-muted-foreground)}
  .browse>div{display:flex;gap:7px;align-items:center}.browse button{border:1px solid var(--color-border);border-radius:6px;width:30px;height:30px;font-size:15px}
  .reader-excerpt,.full-source{flex:1 0 8rem;min-height:8rem;overflow:auto;overscroll-behavior:contain;margin:12px 0;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
  .reader-footer{display:flex;flex-wrap:wrap;align-items:center;gap:9px;border-top:1px solid var(--color-border);padding-top:12px;color:var(--color-muted-foreground);font-size:10px}
  .reader-footer button,.guide-heading button{padding:7px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:11px;min-height:30px}
  .reader h2,.activity-detail,.browse,.reader-footer{flex-shrink:0}
  .region-guide{flex:1;min-height:0;overflow:auto;padding:18px;overscroll-behavior:contain}
  .guide-heading{font-size:14px;color:var(--color-foreground)}.guide-heading>div{display:flex;gap:5px}
  .guide-help,.region-count{font-size:12px;line-height:1.6;color:var(--color-muted-foreground);margin:12px 0}
  .region-list{display:flex;flex-direction:column}.region-list>button{padding:12px 0;border-bottom:1px solid var(--color-border);text-align:left;width:100%}
  .region-list>button:hover,.region-list>button:focus-visible{background:var(--color-accent)}
  .region-list>button>span{display:flex;gap:8px;align-items:center;font-size:13px}.region-list i{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .region-list small{margin-left:auto;color:var(--color-muted-foreground);font-size:11px}
  .region-list p{font-size:11px;line-height:1.6;color:var(--color-muted-foreground);margin:6px 0 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
  .region-name{font-size:18px;margin-top:16px}
  .region-examples{display:flex;flex-direction:column}.region-examples button{padding:12px 0;border-bottom:1px solid var(--color-border);text-align:left}
  .region-examples strong{display:block;font-size:13px;font-weight:550}.region-examples span{display:block;font-size:12px;line-height:1.6;color:var(--color-muted-foreground);margin-top:6px}
  @media(any-pointer:coarse){
    .strength-heading button,.browse button,.reader-footer button,.guide-heading button,
    .region-name-actions button,.region-naming button,.region-children button{min-width:44px;min-height:44px}
  }
  @container(max-width:450px){.dock{right:12px;top:12px}.dock-open{width:calc(100% - 24px);height:min(560px,calc(100% - 124px));border-radius:14px}.reader,.region-guide{padding:14px}.reader h2{font-size:17px;margin:5px 0}.activity-detail{margin-bottom:7px}.browse{padding:6px 0}.reader-excerpt,.full-source{margin:8px 0}.reader-footer{padding-top:8px}}
</style>
