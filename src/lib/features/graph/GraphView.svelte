<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    select,
    forceSimulation,
    forceLink,
    forceManyBody,
    forceCollide,
    forceX,
    forceY,
    zoom as d3Zoom,
    zoomIdentity,
    drag as d3Drag,
    type Simulation,
    type D3ZoomEvent,
    type Selection,
    type ZoomTransform,
    type ZoomBehavior
  } from 'd3';
  import { invoke } from '@tauri-apps/api/core';
  import {
    buildClusterAnchors,
    buildClusterBubbles,
    clusterColor,
    getGraphBounds
  } from './graphLayout';
  import {
    buildClusterLookups,
    buildSimData as prepareSimData,
    createNodeRenderInfoMap,
    getClusterColorIndex,
    getClusterLabel,
    type ClusterLookups,
    type GraphPrepConfig,
    type NodeRenderInfo
  } from './graphPrep';
  import type {
    GraphData,
    SimNode,
    SimLink,
    ClusterBubble,
    GraphPositionEntry
  } from '$lib/types/graph';

  const INFERRED_EDGE_SIMILARITY_THRESHOLD = 0.72;
  const MAX_INFERRED_EDGES_PER_NODE = 3;
  const CLUSTER_VIEW_END_ZOOM = 0.95;
  const NODE_BLEND_END_ZOOM = 1.4;
  const LABEL_SHOW_ZOOM = 1.15;
  const LABEL_FADE_RANGE = 0.16;
  const WIKILINK_SHOW_ZOOM = 0.82;
  const DIMMED_MATCH_SCORE = 0.15;
  const STRONG_MATCH_SCORE = 0.7;
  const UNKNOWN_CLUSTER_LABEL = 'Unknown';
  const ENTRY_ANIMATION_SCALE = 0.90;
  const ENTRY_ANIMATION_JITTER = 52;
  const ENTRY_BURST_PROBABILITY = 0.6;
  const ENTRY_SWIRL_DISTANCE = 78;
  const ENTRY_SWIRL_VELOCITY = 1.55;
  const ENTRY_START_DELAY_MS = 100;
  const INITIAL_SIMULATION_ALPHA = 0.72;
  const DRAG_REHEAT_ALPHA = 0.16;
  const SETTLE_STOP_ALPHA = 0.045;
  const POSITION_SAVE_EPSILON = 0.75;

  interface Props {
    data: GraphData;
    searchQuery: string;
    onZoomChange: (zoom: number) => void;
    timeFilterRange: [number, number] | null;
  }

  let { data, searchQuery, onZoomChange, timeFilterRange }: Props = $props();

  let containerEl: HTMLDivElement;
  let svgEl: SVGSVGElement;
  let simulation: Simulation<SimNode, SimLink> | null = null;
  let currentTransform: ZoomTransform = zoomIdentity;
  let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let tooltipNode = $state<SimNode | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  let simNodes: SimNode[] = [];
  let simLinks: SimLink[] = [];
  let clusterBubbles: ClusterBubble[] = [];
  let nodeRenderInfo = new Map<string, NodeRenderInfo>();
  let clusterLookups = $state<ClusterLookups>(buildClusterLookups([]));
  let persistedPositions = new Map<string, { x: number; y: number }>();

  let savePositionTimer: ReturnType<typeof setTimeout> | null = null;
  let entryDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let renderFrameHandle: number | null = null;
  let queuedBubbleRefresh = false;
  let hasFittedOnce = false;
  let hasUserInteracted = false;
  let isDraggingNode = false;
  let lastGraphData: GraphData | null = null;
  let isMounted = false;

  let graphContainerSelection: Selection<SVGGElement, unknown, null, undefined> | null = null;
  let clusterSelection: Selection<SVGGElement, ClusterBubble, SVGGElement, unknown> | null = null;
  let edgeSelection: Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null = null;
  let nodeSelection: Selection<SVGCircleElement, SimNode, SVGGElement, unknown> | null = null;
  let labelSelection: Selection<SVGTextElement, SimNode, SVGGElement, unknown> | null = null;

  const graphPrepConfig: GraphPrepConfig = {
    inferredEdgeSimilarityThreshold: INFERRED_EDGE_SIMILARITY_THRESHOLD,
    maxInferredEdgesPerNode: MAX_INFERRED_EDGES_PER_NODE,
    strongMatchScore: STRONG_MATCH_SCORE,
    unknownClusterLabel: UNKNOWN_CLUSTER_LABEL,
    entryAnimationScale: ENTRY_ANIMATION_SCALE,
    entryAnimationJitter: ENTRY_ANIMATION_JITTER,
    entryBurstProbability: ENTRY_BURST_PROBABILITY,
    entrySwirlDistance: ENTRY_SWIRL_DISTANCE,
    entrySwirlVelocity: ENTRY_SWIRL_VELOCITY
  };

  function refreshNodeRenderInfo() {
    nodeRenderInfo = createNodeRenderInfoMap(simNodes, {
      searchQuery,
      timeFilterRange,
      clusterLookups,
      strongMatchScore: STRONG_MATCH_SCORE
    });
  }

  function rebuildSimData(graphData: GraphData) {
    const prepared = prepareSimData(graphData, graphPrepConfig);
    simNodes = prepared.simNodes;
    simLinks = prepared.simLinks;
    refreshNodeRenderInfo();
  }

  function graphDataEquals(left: GraphData | null, right: GraphData | null) {
    if (left === right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }

    if (
      left.timeRange[0] !== right.timeRange[0] ||
      left.timeRange[1] !== right.timeRange[1] ||
      left.nodes.length !== right.nodes.length ||
      left.clusters.length !== right.clusters.length ||
      left.wikilinkEdges.length !== right.wikilinkEdges.length ||
      left.inferredEdges.length !== right.inferredEdges.length
    ) {
      return false;
    }

    for (let index = 0; index < left.clusters.length; index += 1) {
      const leftCluster = left.clusters[index];
      const rightCluster = right.clusters[index];
      if (
        leftCluster.id !== rightCluster.id ||
        leftCluster.label !== rightCluster.label ||
        leftCluster.noteCount !== rightCluster.noteCount ||
        leftCluster.colorIndex !== rightCluster.colorIndex
      ) {
        return false;
      }
    }

    for (let index = 0; index < left.nodes.length; index += 1) {
      const leftNode = left.nodes[index];
      const rightNode = right.nodes[index];
      if (
        leftNode.path !== rightNode.path ||
        leftNode.title !== rightNode.title ||
        leftNode.snippet !== rightNode.snippet ||
        leftNode.clusterId !== rightNode.clusterId ||
        leftNode.createdAtMillis !== rightNode.createdAtMillis ||
        leftNode.modifiedMillis !== rightNode.modifiedMillis ||
        leftNode.xHint !== rightNode.xHint ||
        leftNode.yHint !== rightNode.yHint
      ) {
        return false;
      }
    }

    for (let index = 0; index < left.wikilinkEdges.length; index += 1) {
      const leftEdge = left.wikilinkEdges[index];
      const rightEdge = right.wikilinkEdges[index];
      if (leftEdge.source !== rightEdge.source || leftEdge.target !== rightEdge.target) {
        return false;
      }
    }

    for (let index = 0; index < left.inferredEdges.length; index += 1) {
      const leftEdge = left.inferredEdges[index];
      const rightEdge = right.inferredEdges[index];
      if (
        leftEdge.source !== rightEdge.source ||
        leftEdge.target !== rightEdge.target ||
        leftEdge.score !== rightEdge.score
      ) {
        return false;
      }
    }

    return true;
  }

  function edgeKey(link: SimLink) {
    return `${link.source.path}::${link.target.path}::${link.type}`;
  }

  function syncClusterScene() {
    if (!graphContainerSelection) return;

    const clusterSel = graphContainerSelection
      .selectAll<SVGGElement, ClusterBubble>('.cluster-group')
      .data(clusterBubbles, (d: ClusterBubble) => String(d.id));

    const clusterEnter = clusterSel.enter().insert('g', ':first-child').attr('class', 'cluster-group');
    clusterEnter.append('path').attr('class', 'cluster-shape-outline');
    clusterEnter.append('path').attr('class', 'cluster-shape');
    clusterEnter.append('text').attr('class', 'cluster-label');
    clusterEnter.append('text').attr('class', 'cluster-count');

    clusterSelection = clusterEnter.merge(clusterSel);
    clusterSel.exit().remove();

    clusterSelection.on('click', (_event: MouseEvent, d: ClusterBubble) => {
      if (!zoomBehavior) return;
      const svgSel = select(svgEl);
      const width = containerEl.clientWidth;
      const height = containerEl.clientHeight;
      const padding = Math.max(64, Math.min(width, height) * 0.12);
      const bubbleWidth = Math.max(d.maxX - d.minX, 1);
      const bubbleHeight = Math.max(d.maxY - d.minY, 1);
      const fitScale = Math.min(
        (width - padding * 2) / bubbleWidth,
        (height - padding * 2) / bubbleHeight
      );
      const targetK = Math.min(Math.max(fitScale, LABEL_SHOW_ZOOM + 0.08), 4.5);
      const targetTransform = zoomIdentity
        .translate(width / 2 - d.cx * targetK, height / 2 - d.cy * targetK)
        .scale(targetK);
      svgSel.transition().duration(600).call(zoomBehavior.transform, targetTransform);
    });
  }

  function syncEdgeScene() {
    if (!graphContainerSelection) return;

    const visibleEdges = simLinks.filter((link) => link.type === 'wikilink');
    const edgeSel = graphContainerSelection
      .selectAll<SVGLineElement, SimLink>('.edge-line')
      .data(visibleEdges, edgeKey);

    edgeSelection = edgeSel.enter().append('line').attr('class', 'edge-line').merge(edgeSel);
    edgeSel.exit().remove();
  }

  function syncNodeScene() {
    if (!graphContainerSelection) return;

    const nodeSel = graphContainerSelection
      .selectAll<SVGCircleElement, SimNode>('.node-circle')
      .data(simNodes, (d: SimNode) => d.path);

    nodeSelection = nodeSel.enter().append('circle').attr('class', 'node-circle').merge(nodeSel);
    nodeSel.exit().remove();

    nodeSelection
      .on('mouseenter', (event: MouseEvent, d: SimNode) => {
        tooltipNode = d;
        tooltipX = event.clientX;
        tooltipY = event.clientY;
      })
      .on('mousemove', (event: MouseEvent) => {
        tooltipX = event.clientX;
        tooltipY = event.clientY;
      })
      .on('mouseleave', () => {
        tooltipNode = null;
      })
      .on('click', (_event: MouseEvent, d: SimNode) => {
        void invoke('open_note', { path: d.path }).then(() => goto('/'));
      });

    const dragBehavior = d3Drag<SVGCircleElement, SimNode>()
      .on('start', (event: { active: number }, d: SimNode) => {
        hasUserInteracted = true;
        isDraggingNode = true;
        if (!event.active) simulation?.alpha(DRAG_REHEAT_ALPHA).alphaTarget(0.12).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: { x: number; y: number }, d: SimNode) => {
        d.fx = event.x;
        d.fy = event.y;
        scheduleRender(true);
      })
      .on('end', (event: { active: number }, d: SimNode) => {
        isDraggingNode = false;
        if (!event.active) simulation?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        scheduleSavePositions();
      });

    nodeSelection.call(dragBehavior);

    const labelSel = graphContainerSelection
      .selectAll<SVGTextElement, SimNode>('.node-label')
      .data(simNodes, (d: SimNode) => d.path);

    labelSelection = labelSel.enter().append('text').attr('class', 'node-label').merge(labelSel);
    labelSel.exit().remove();
  }

  function makeClusterCollisionForce(padding: number) {
    return (alpha: number) => {
      const groups = new Map<number, SimNode[]>();
      for (const node of simNodes) {
        let list = groups.get(node.clusterId);
        if (!list) { list = []; groups.set(node.clusterId, list); }
        list.push(node);
      }

      const clusterInfo: { id: number; cx: number; cy: number; radius: number; nodes: SimNode[] }[] = [];
      for (const [id, nodes] of groups) {
        let cx = 0, cy = 0;
        for (const n of nodes) { cx += n.x; cy += n.y; }
        cx /= nodes.length; cy /= nodes.length;
        let maxDist = 0;
        for (const n of nodes) {
          const d = Math.hypot(n.x - cx, n.y - cy);
          if (d > maxDist) maxDist = d;
        }
        clusterInfo.push({ id, cx, cy, radius: maxDist + padding, nodes });
      }

      for (let i = 0; i < clusterInfo.length; i++) {
        for (let j = i + 1; j < clusterInfo.length; j++) {
          const a = clusterInfo[i];
          const b = clusterInfo[j];
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const dist = Math.hypot(dx, dy) || 1;
          const minDist = a.radius + b.radius;

          if (dist < minDist) {
            const pushStrength = ((minDist - dist) / dist) * alpha * 0.35;
            const nx = dx / dist;
            const ny = dy / dist;
            const pushX = nx * pushStrength;
            const pushY = ny * pushStrength;

            for (const n of a.nodes) { n.vx -= pushX; n.vy -= pushY; }
            for (const n of b.nodes) { n.vx += pushX; n.vy += pushY; }
          }
        }
      }
    };
  }

  function initSimulation() {
    if (!svgEl || !graphContainerSelection || simNodes.length === 0) return;

    const n = simNodes.length;
    const chargeStrength = -Math.max(250, Math.min(1000, n * 5));
    const linkDist = Math.max(80, Math.min(250, Math.sqrt(n) * 15));
    const layoutLinks = simLinks.filter((link) => link.type !== 'wikilink');

    const clusterAnchors = buildClusterAnchors(data.clusters, n);
    const anchorRadius = Math.max(240, Math.sqrt(n) * 65);

    simulation = forceSimulation<SimNode, SimLink>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(layoutLinks)
        .id((d: SimNode) => d.path)
        .distance(linkDist)
        .strength((link: SimLink) => 0.08 * link.weight))
      .force('charge', forceManyBody<SimNode>().strength(chargeStrength).distanceMax(anchorRadius * 3))
      .force('collide', forceCollide<SimNode>().radius((d: SimNode) => d.radius + 8).strength(0.9).iterations(3))
      .force('clusterX', forceX<SimNode>((d: SimNode) => {
        const anchor = clusterAnchors.get(d.clusterId);
        return anchor ? anchor.x : 0;
      }).strength(0.12))
      .force('clusterY', forceY<SimNode>((d: SimNode) => {
        const anchor = clusterAnchors.get(d.clusterId);
        return anchor ? anchor.y : 0;
      }).strength(0.12))
      .force('clusterCollision', makeClusterCollisionForce(18))
      .force('centerX', forceX(0).strength(0.005))
      .force('centerY', forceY(0).strength(0.005))
      .alphaMin(SETTLE_STOP_ALPHA)
      .alphaDecay(0.028)
      .velocityDecay(0.35)
      .on('tick', () => {
        scheduleRender();
        if (!hasFittedOnce && !hasUserInteracted && simulation && simulation.alpha() < 0.12) {
          hasFittedOnce = true;
          fitAll(false);
        }
        if (!isDraggingNode && simulation && simulation.alpha() <= SETTLE_STOP_ALPHA) {
          simulation.stop();
          scheduleSavePositions();
        }
      });

    simulation.alpha(0);

    const svg = select(svgEl);
    zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 10])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (event.sourceEvent) {
          hasUserInteracted = true;
        }
        currentTransform = event.transform;
        onZoomChange(Math.round(currentTransform.k * 100) / 100);
        scheduleRender();
      });

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);
    svg.on('dblclick', () => fitAll());

    currentTransform = zoomIdentity;
    onZoomChange(1);
    requestAnimationFrame(() => {
      scheduleRender(true);
      fitAll(false, true);
    });

    entryDelayTimer = setTimeout(() => {
      simulation?.alpha(INITIAL_SIMULATION_ALPHA).restart();
    }, ENTRY_START_DELAY_MS);
  }

  function updateClusterScene(clusterOpacity: number) {
    if (!clusterSelection) return;

    clusterSelection
      .style('opacity', String(clusterOpacity))
      .style('pointer-events', clusterOpacity > 0.1 ? 'all' : 'none');

    clusterSelection.select<SVGPathElement>('.cluster-shape-outline')
      .attr('d', (d: ClusterBubble) => d.path)
      .attr('fill', 'none')
      .attr('stroke', 'var(--foreground)')
      .attr('stroke-opacity', 0.16)
      .attr('stroke-width', 5.5)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .style('filter', 'drop-shadow(0 12px 24px rgba(0, 0, 0, 0.18))');

    clusterSelection.select<SVGPathElement>('.cluster-shape')
      .attr('d', (d: ClusterBubble) => d.path)
      .attr('fill', (d: ClusterBubble) => clusterColor(d.colorIndex))
      .attr('fill-opacity', 0.1)
      .attr('stroke', (d: ClusterBubble) => clusterColor(d.colorIndex))
      .attr('stroke-opacity', 0.8)
      .attr('stroke-width', 2.25)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .style('filter', 'drop-shadow(0 0 16px rgba(0, 0, 0, 0.12))');

    clusterSelection.select<SVGTextElement>('.cluster-label')
      .attr('x', (d: ClusterBubble) => d.cx)
      .attr('y', (d: ClusterBubble) => d.cy - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--foreground)')
      .attr('font-size', '30px')
      .attr('font-weight', '600')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'var(--background)')
      .attr('stroke-opacity', 0.94)
      .attr('stroke-width', 4.75)
      .style('letter-spacing', '0.02em')
      .text((d: ClusterBubble) => d.label);

    clusterSelection.select<SVGTextElement>('.cluster-count')
      .attr('x', (d: ClusterBubble) => d.cx)
      .attr('y', (d: ClusterBubble) => d.cy + 21)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--muted-foreground)')
      .attr('font-size', '14px')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'var(--background)')
      .attr('stroke-opacity', 0.9)
      .attr('stroke-width', 3.5)
      .text((d: ClusterBubble) => `${d.noteCount} notes`);
  }

  function updateEdgeScene(wikilinkOpacity: number) {
    if (!edgeSelection) return;

    edgeSelection
      .attr('x1', (d: SimLink) => d.source.x)
      .attr('y1', (d: SimLink) => d.source.y)
      .attr('x2', (d: SimLink) => d.target.x)
      .attr('y2', (d: SimLink) => d.target.y)
      .attr('stroke', (d: SimLink) => clusterColor(getClusterColorIndex(d.source.clusterId, clusterLookups)))
      .attr('stroke-opacity', wikilinkOpacity)
      .attr('stroke-width', 1.15)
      .attr('stroke-dasharray', 'none');
  }

  function updateNodeScene(nodeOpacity: number) {
    if (!nodeSelection) return;

    nodeSelection
      .attr('cx', (d: SimNode) => d.x)
      .attr('cy', (d: SimNode) => d.y)
      .attr('r', (d: SimNode) => {
        const info = nodeRenderInfo.get(d.path);
        const base = d.radius;
        if (!info) return base;
        if (!info.inRange) return base * 0.5;
        if (info.matchScore < DIMMED_MATCH_SCORE) return base * 0.7;
        if (info.matchScore >= STRONG_MATCH_SCORE) return base * 1.2;
        return base;
      })
      .attr('fill', (d: SimNode) => clusterColor(getClusterColorIndex(d.clusterId, clusterLookups)))
      .attr('fill-opacity', (d: SimNode) => {
        const info = nodeRenderInfo.get(d.path);
        if (!info) return nodeOpacity;
        if (!info.inRange) return 0.1;
        if (info.matchScore < DIMMED_MATCH_SCORE) return nodeOpacity * 0.24;
        return nodeOpacity;
      })
      .attr('stroke', 'var(--foreground)')
      .attr('stroke-opacity', (d: SimNode) => {
        const info = nodeRenderInfo.get(d.path);
        if (!info) return nodeOpacity * 0.5;
        if (!info.inRange) return 0.05;
        return nodeOpacity * 0.5;
      })
      .attr('stroke-width', 0.9)
      .style('cursor', 'pointer');
  }

  function updateLabelScene(labelOpacity: number) {
    if (!labelSelection) return;

    labelSelection
      .attr('x', (d: SimNode) => d.x)
      .attr('y', (d: SimNode) => d.y - d.radius - 7)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--foreground)')
      .attr('font-size', '13.5px')
      .attr('pointer-events', 'none')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'var(--background)')
      .attr('stroke-opacity', 0.92)
      .attr('stroke-width', 3.8)
      .style('opacity', (d: SimNode) => {
        const info = nodeRenderInfo.get(d.path);
        if (!info?.inRange) return 0;
        return labelOpacity * (info.matchScore < DIMMED_MATCH_SCORE ? 0.15 : 1);
      })
      .text((d: SimNode) => d.shortTitle);
  }

  function updateClusterBubbles(clusterVisible: boolean, force = false) {
    if (!force && !clusterVisible) {
      return;
    }

    clusterBubbles = buildClusterBubbles(simNodes, data.clusters);
    syncClusterScene();
  }

  function render(forceBubbleRefresh = false) {
    if (!svgEl || !graphContainerSelection) return;
    const k = currentTransform.k;

    const clusterOpacity =
      k <= CLUSTER_VIEW_END_ZOOM
        ? 1.0
        : k < NODE_BLEND_END_ZOOM
          ? Math.max(0, 1.0 - (k - CLUSTER_VIEW_END_ZOOM) / (NODE_BLEND_END_ZOOM - CLUSTER_VIEW_END_ZOOM))
          : 0;
    const nodeOpacity =
      k <= CLUSTER_VIEW_END_ZOOM
        ? 0.14
        : k < NODE_BLEND_END_ZOOM
          ? 0.14 + 0.86 * ((k - CLUSTER_VIEW_END_ZOOM) / (NODE_BLEND_END_ZOOM - CLUSTER_VIEW_END_ZOOM))
          : 1.0;
    const labelOpacity =
      k <= LABEL_SHOW_ZOOM
        ? 0
        : Math.min(1, (k - LABEL_SHOW_ZOOM) / LABEL_FADE_RANGE);
    const wikilinkOpacity =
      k <= WIKILINK_SHOW_ZOOM
        ? 0
        : Math.min(0.42, ((k - WIKILINK_SHOW_ZOOM) / 0.8) * 0.42);

    graphContainerSelection.attr('transform', currentTransform.toString());
    updateClusterBubbles(clusterOpacity > 0.01, forceBubbleRefresh);
    updateClusterScene(clusterOpacity);
    updateEdgeScene(wikilinkOpacity);
    updateNodeScene(nodeOpacity);
    updateLabelScene(labelOpacity);
  }

  function scheduleRender(forceBubbleRefresh = false) {
    queuedBubbleRefresh = queuedBubbleRefresh || forceBubbleRefresh;
    if (renderFrameHandle !== null) {
      return;
    }

    renderFrameHandle = requestAnimationFrame(() => {
      renderFrameHandle = null;
      const nextForceBubbleRefresh = queuedBubbleRefresh;
      queuedBubbleRefresh = false;
      render(nextForceBubbleRefresh);
    });
  }

  function teardownGraphView() {
    simulation?.stop();
    simulation = null;
    tooltipNode = null;
    if (savePositionTimer) {
      clearTimeout(savePositionTimer);
      savePositionTimer = null;
    }
    if (entryDelayTimer) {
      clearTimeout(entryDelayTimer);
      entryDelayTimer = null;
    }
    if (renderFrameHandle !== null) {
      cancelAnimationFrame(renderFrameHandle);
      renderFrameHandle = null;
    }
    queuedBubbleRefresh = false;
    isDraggingNode = false;
    persistedPositions.clear();
    clusterSelection = null;
    edgeSelection = null;
    nodeSelection = null;
    labelSelection = null;
    graphContainerSelection?.selectAll('*').remove();
  }

  function resetPersistedPositions(graphData: GraphData) {
    persistedPositions = new Map(
      graphData.nodes
        .filter((node) => node.xHint !== null && node.yHint !== null)
        .map((node) => [node.path, { x: node.xHint as number, y: node.yHint as number }])
    );
  }

  function positionNeedsSave(node: SimNode) {
    const persisted = persistedPositions.get(node.path);
    if (!persisted) {
      return true;
    }
    return (
      Math.abs(persisted.x - node.x) > POSITION_SAVE_EPSILON ||
      Math.abs(persisted.y - node.y) > POSITION_SAVE_EPSILON
    );
  }

  function rebuildGraphView() {
    if (!graphContainerSelection) return;

    teardownGraphView();
    lastGraphData = data;
    hasFittedOnce = false;
    hasUserInteracted = false;
    clusterLookups = buildClusterLookups(data.clusters);
    resetPersistedPositions(data);
    rebuildSimData(data);
    clusterBubbles = buildClusterBubbles(simNodes, data.clusters);
    syncClusterScene();
    syncEdgeScene();
    syncNodeScene();
    initSimulation();
    scheduleRender(true);
  }

  function scheduleSavePositions() {
    if (savePositionTimer) clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
      const positions: GraphPositionEntry[] = simNodes
        .filter(positionNeedsSave)
        .map((node) => ({
          path: node.path,
          x: node.x,
          y: node.y
        }));

      if (positions.length === 0) {
        return;
      }

      void invoke('save_graph_node_positions', { positions }).then(() => {
        for (const position of positions) {
          persistedPositions.set(position.path, { x: position.x, y: position.y });
        }
      });
    }, 1000);
  }

  export function fitAll(animate = true, useHomePositions = false) {
    if (!svgEl || simNodes.length === 0 || !zoomBehavior) return;

    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;
    if (width === 0 || height === 0) return;

    const { minX, minY, maxX, maxY } = getGraphBounds(simNodes, data.clusters, useHomePositions);

    const graphW = maxX - minX;
    const graphH = maxY - minY;
    if (graphW <= 0 || graphH <= 0) return;

    const padding = Math.max(108, Math.min(width, height) * 0.11);
    const scaleX = (width - padding * 2) / graphW;
    const scaleY = (height - padding * 2) / graphH;
    const scale = Math.min(scaleX, scaleY, 0.8);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const targetTransform = zoomIdentity
      .translate(width / 2 - cx * scale, height / 2 - cy * scale)
      .scale(scale);

    const svg = select(svgEl);
    if (animate) {
      svg.transition().duration(500).call(zoomBehavior.transform, targetTransform);
    } else {
      svg.call(zoomBehavior.transform, targetTransform);
    }
  }

  $effect(() => {
    searchQuery;
    timeFilterRange;
    refreshNodeRenderInfo();
    scheduleRender();
  });

  $effect(() => {
    data;
    if (!isMounted || graphDataEquals(data, lastGraphData)) {
      return;
    }
    rebuildGraphView();
  });

  onMount(() => {
    const svg = select(svgEl);
    graphContainerSelection = svg.append('g').attr('class', 'graph-container');
    isMounted = true;
    rebuildGraphView();

    const resizeObserver = new ResizeObserver(() => scheduleRender(true));
    resizeObserver.observe(containerEl);

    return () => {
      teardownGraphView();
      isMounted = false;
      resizeObserver.disconnect();
    };
  });
</script>

<div class="graph-view relative h-full w-full overflow-hidden bg-background" bind:this={containerEl}>
  <div
    class="pointer-events-none absolute inset-0 opacity-55"
    style="background:
      radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.04), transparent 32%),
      radial-gradient(circle at 80% 30%, rgba(255, 255, 255, 0.025), transparent 28%),
      radial-gradient(circle at 50% 100%, rgba(255, 255, 255, 0.04), transparent 38%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.18));"
  ></div>
  <div
    class="pointer-events-none absolute inset-0 opacity-[0.03]"
    style="background-image:
      linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px);
      background-size: 32px 32px;"
  ></div>
  <svg bind:this={svgEl} class="h-full w-full"></svg>

  {#if tooltipNode}
    <div
      class="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-border/80 bg-card px-3 py-2 text-sm shadow-lg"
      style="left: {tooltipX + 12}px; top: {tooltipY - 8}px"
    >
      <div class="font-medium text-foreground">{tooltipNode.title}</div>
      {#if tooltipNode.snippet}
        <div class="mt-1 text-xs text-muted-foreground line-clamp-2">{tooltipNode.snippet}</div>
      {/if}
      <div
        class="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
        style="background: {clusterColor(getClusterColorIndex(tooltipNode.clusterId, clusterLookups))}20; color: {clusterColor(getClusterColorIndex(tooltipNode.clusterId, clusterLookups))}"
      >
        {getClusterLabel(tooltipNode.clusterId, clusterLookups, UNKNOWN_CLUSTER_LABEL)}
      </div>
    </div>
  {/if}
</div>
