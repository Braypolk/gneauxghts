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
    type ZoomTransform,
    type ZoomBehavior
  } from 'd3';
  import { invoke } from '@tauri-apps/api/core';
  import {
    buildClusterAnchors,
    buildClusterBubbles,
    clusterColor,
    getGraphBounds,
    nodeRadius,
    temporalDecay
  } from './graphLayout';
  import type {
    GraphData,
    SimNode,
    SimLink,
    ClusterBubble,
    GraphPositionEntry
  } from '$lib/types/graph';

  const INFERRED_EDGE_COLOR = '#B4B2A9';
  const INFERRED_EDGE_SIMILARITY_THRESHOLD = 0.72;
  const MAX_INFERRED_EDGES_PER_NODE = 3;
  const CLUSTER_VIEW_END_ZOOM = 0.95;
  const NODE_BLEND_END_ZOOM = 1.4;
  const LABEL_SHOW_ZOOM = 1.15;
  const LABEL_FADE_RANGE = 0.16;
  const INFERRED_EDGE_SHOW_ZOOM = 1.05;
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

  interface Props {
    data: GraphData;
    searchQuery: string;
    onZoomChange: (zoom: number) => void;
    timeFilterRange: [number, number] | null;
  }

  interface NodeRenderInfo {
    matchScore: number;
    inRange: boolean;
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
  let clusterColorIndexById = new Map<number, number>();
  let clusterLabelById = new Map<number, string>();
  let clusterLabelLowerById = new Map<number, string>();

  let savePositionTimer: ReturnType<typeof setTimeout> | null = null;
  let entryDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let hasFittedOnce = false;
  let hasUserInteracted = false;

  function hintsAreUsable(nodes: GraphData['nodes']): boolean {
    const withHints = nodes.filter((n) => n.xHint !== null && n.yHint !== null);
    if (withHints.length < 2) return false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of withHints) {
      if (n.xHint! < minX) minX = n.xHint!;
      if (n.xHint! > maxX) maxX = n.xHint!;
      if (n.yHint! < minY) minY = n.yHint!;
      if (n.yHint! > maxY) maxY = n.yHint!;
    }
    const span = Math.max(maxX - minX, maxY - minY);
    return span > 50;
  }

  function rebuildClusterLookups() {
    clusterColorIndexById = new Map(data.clusters.map((cluster) => [cluster.id, cluster.colorIndex]));
    clusterLabelById = new Map(data.clusters.map((cluster) => [cluster.id, cluster.label]));
    clusterLabelLowerById = new Map(
      data.clusters.map((cluster) => [cluster.id, cluster.label.toLowerCase()])
    );
  }

  function searchMatchScore(node: SimNode, normalizedQuery: string): number {
    if (!normalizedQuery) return 1.0;
    if (node.titleLower.includes(normalizedQuery)) return 1.0;
    if (node.snippetLower.includes(normalizedQuery)) return STRONG_MATCH_SCORE;
    if (clusterLabelLowerById.get(node.clusterId)?.includes(normalizedQuery)) return 0.5;
    return 0;
  }

  function isInTimeRange(node: SimNode): boolean {
    if (!timeFilterRange) return true;
    return node.createdAtMillis >= timeFilterRange[0] && node.createdAtMillis <= timeFilterRange[1];
  }

  function refreshNodeRenderInfo() {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    nodeRenderInfo = new Map(
      simNodes.map((node) => [
        node.path,
        {
          matchScore: searchMatchScore(node, normalizedQuery),
          inRange: isInTimeRange(node)
        }
      ])
    );
  }

  function getClusterColorIndex(clusterId: number): number {
    return clusterColorIndexById.get(clusterId) ?? 0;
  }

  function getClusterLabel(clusterId: number): string {
    return clusterLabelById.get(clusterId) ?? UNKNOWN_CLUSTER_LABEL;
  }

  function buildSimData(graphData: GraphData) {
    const nodeMap = new Map<string, SimNode>();
    const hasHints = hintsAreUsable(graphData.nodes);

    const clusterAnchors = buildClusterAnchors(graphData.clusters, graphData.nodes.length);
    const spreadRadius = Math.max(200, Math.sqrt(graphData.nodes.length) * 50);

    simNodes = graphData.nodes.map((n) => {
      let targetX: number;
      let targetY: number;

      if (hasHints && n.xHint !== null && n.yHint !== null) {
        targetX = n.xHint;
        targetY = n.yHint;
      } else {
        const anchor = clusterAnchors.get(n.clusterId) ?? { x: 0, y: 0 };
        const jitter = Math.max(40, spreadRadius * 0.3);
        targetX = anchor.x + (Math.random() - 0.5) * jitter;
        targetY = anchor.y + (Math.random() - 0.5) * jitter;
      }

      const burst = Math.random() < ENTRY_BURST_PROBABILITY;
      const targetDistance = Math.hypot(targetX, targetY) || 1;
      const radialX = targetX / targetDistance;
      const radialY = targetY / targetDistance;
      const tangentX = -radialY;
      const tangentY = radialX;
      const swirlOffset = burst ? (Math.random() - 0.5) * ENTRY_SWIRL_DISTANCE : 0;
      const compressionScale = burst
        ? ENTRY_ANIMATION_SCALE * (0.4 + Math.random() * 0.9)
        : ENTRY_ANIMATION_SCALE * (0.8 + Math.random() * 0.3);
      const x =
        targetX * compressionScale
        + tangentX * swirlOffset
        + (Math.random() - 0.5) * ENTRY_ANIMATION_JITTER;
      const y =
        targetY * compressionScale
        + tangentY * swirlOffset
        + (Math.random() - 0.5) * ENTRY_ANIMATION_JITTER;
      const swirlVelocity = burst ? (Math.random() - 0.5) * ENTRY_SWIRL_VELOCITY : (Math.random() - 0.5) * 0.28;

      const node: SimNode = {
        ...n,
        x,
        y,
        homeX: targetX,
        homeY: targetY,
        vx: (targetX - x) * 0.02 + tangentX * swirlVelocity,
        vy: (targetY - y) * 0.02 + tangentY * swirlVelocity,
        fx: null,
        fy: null,
        radius: nodeRadius(n.modifiedMillis),
        shortTitle: n.title.length > 24 ? `${n.title.slice(0, 22)}...` : n.title,
        titleLower: n.title.toLowerCase(),
        snippetLower: n.snippet.toLowerCase()
      };
      nodeMap.set(n.path, node);
      return node;
    });

    const wikilinkSet = new Set<string>();
    const links: SimLink[] = [];

    for (const wl of graphData.wikilinkEdges) {
      const s = nodeMap.get(wl.source);
      const t = nodeMap.get(wl.target);
      if (s && t) {
        const key = [wl.source, wl.target].sort().join('::');
        wikilinkSet.add(key);
        links.push({ source: s, target: t, type: 'wikilink', score: 1.0, weight: 1.0 });
      }
    }

    const inferredCountPerNode = new Map<string, number>();
    const filteredInferred = graphData.inferredEdges
      .filter((e) => e.score >= INFERRED_EDGE_SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    for (const edge of filteredInferred) {
      const key = [edge.source, edge.target].sort().join('::');
      if (wikilinkSet.has(key)) continue;

      const srcCount = inferredCountPerNode.get(edge.source) ?? 0;
      const tgtCount = inferredCountPerNode.get(edge.target) ?? 0;
      if (srcCount >= MAX_INFERRED_EDGES_PER_NODE && tgtCount >= MAX_INFERRED_EDGES_PER_NODE) {
        continue;
      }

      const s = nodeMap.get(edge.source);
      const t = nodeMap.get(edge.target);
      if (s && t) {
        const weight = temporalDecay(s.createdAtMillis, t.createdAtMillis, edge.score);
        links.push({ source: s, target: t, type: 'inferred', score: edge.score, weight });
        inferredCountPerNode.set(edge.source, srcCount + 1);
        inferredCountPerNode.set(edge.target, tgtCount + 1);
      }
    }

    simLinks = links;
    refreshNodeRenderInfo();
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
    if (!svgEl || simNodes.length === 0) return;

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
      .alphaDecay(0.012)
      .velocityDecay(0.35)
      .on('tick', () => {
        render();
        if (!hasFittedOnce && !hasUserInteracted && simulation && simulation.alpha() < 0.12) {
          hasFittedOnce = true;
          fitAll(false);
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
        render();
      });

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);
    svg.on('dblclick', () => fitAll());

    currentTransform = zoomIdentity;
    onZoomChange(1);
    requestAnimationFrame(() => {
      render();
      fitAll(false, true);
    });

    entryDelayTimer = setTimeout(() => {
      simulation?.alpha(0.9).restart();
    }, ENTRY_START_DELAY_MS);
  }

  function render() {
    if (!svgEl) return;
    const svg = select(svgEl);
    const k = currentTransform.k;

    clusterBubbles = buildClusterBubbles(simNodes, data.clusters);

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
    const inferredEdgeOpacity =
      k <= INFERRED_EDGE_SHOW_ZOOM
        ? 0
        : Math.min(0.14, ((k - INFERRED_EDGE_SHOW_ZOOM) / 0.7) * 0.14);

    const g = svg.select<SVGGElement>('.graph-container');
    g.attr('transform', currentTransform.toString());

    // -- Cluster bubbles (drawn first, behind everything) --
    const clusterSel = g.selectAll<SVGGElement, ClusterBubble>('.cluster-group')
      .data(clusterBubbles, (d: ClusterBubble) => String(d.id));

    const clusterEnter = clusterSel.enter().insert('g', ':first-child').attr('class', 'cluster-group');
    clusterEnter.append('path').attr('class', 'cluster-shape');
    clusterEnter.append('text').attr('class', 'cluster-label');
    clusterEnter.append('text').attr('class', 'cluster-count');

    const clusterMerge = clusterEnter.merge(clusterSel);
    clusterMerge.style('opacity', String(clusterOpacity)).style('pointer-events', clusterOpacity > 0.1 ? 'all' : 'none');

    clusterMerge.select<SVGPathElement>('.cluster-shape')
      .attr('d', (d: ClusterBubble) => d.path)
      .attr('fill', (d: ClusterBubble) => clusterColor(d.colorIndex))
      .attr('fill-opacity', 0.1)
      .attr('stroke', (d: ClusterBubble) => clusterColor(d.colorIndex))
      .attr('stroke-opacity', 0.48)
      .attr('stroke-width', 1.35)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .style('filter', 'drop-shadow(0 0 12px rgba(0, 0, 0, 0.22))');

    clusterMerge.select<SVGTextElement>('.cluster-label')
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

    clusterMerge.select<SVGTextElement>('.cluster-count')
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

    clusterSel.exit().remove();

    clusterMerge.on('click', (_event: MouseEvent, d: ClusterBubble) => {
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

    // -- Edges --
    const edgeKey = (d: SimLink) => `${d.source.path}::${d.target.path}::${d.type}`;
    const edgeSel = g.selectAll<SVGLineElement, SimLink>('.edge-line')
      .data(simLinks, edgeKey);

    const edgeEnter = edgeSel.enter().append('line').attr('class', 'edge-line');
    const edgeMerge = edgeEnter.merge(edgeSel);

    edgeMerge
      .attr('x1', (d: SimLink) => d.source.x)
      .attr('y1', (d: SimLink) => d.source.y)
      .attr('x2', (d: SimLink) => d.target.x)
      .attr('y2', (d: SimLink) => d.target.y)
      .attr('stroke', (d: SimLink) => {
        if (d.type === 'wikilink') return clusterColor(getClusterColorIndex(d.source.clusterId));
        return INFERRED_EDGE_COLOR;
      })
      .attr('stroke-opacity', (d: SimLink) => {
        if (d.type === 'wikilink') return wikilinkOpacity;
        return inferredEdgeOpacity;
      })
      .attr('stroke-width', (d: SimLink) => d.type === 'wikilink' ? 1.15 : 0.9)
      .attr('stroke-dasharray', (d: SimLink) => d.type === 'inferred' ? '4 3' : 'none');

    edgeSel.exit().remove();

    // -- Nodes --
    const nodeSel = g.selectAll<SVGCircleElement, SimNode>('.node-circle')
      .data(simNodes, (d: SimNode) => d.path);

    const nodeEnter = nodeSel.enter().append('circle').attr('class', 'node-circle');
    const nodeMerge = nodeEnter.merge(nodeSel);

    nodeMerge
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
      .attr('fill', (d: SimNode) => clusterColor(getClusterColorIndex(d.clusterId)))
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

    nodeMerge
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
        if (!event.active) simulation?.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: { x: number; y: number }, d: SimNode) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event: { active: number }, d: SimNode) => {
        if (!event.active) simulation?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        scheduleSavePositions();
      });

    nodeMerge.call(dragBehavior);

    nodeSel.exit().remove();

    // -- Labels --
    const labelSel = g.selectAll<SVGTextElement, SimNode>('.node-label')
      .data(simNodes, (d: SimNode) => d.path);

    const labelEnter = labelSel.enter().append('text').attr('class', 'node-label');
    const labelMerge = labelEnter.merge(labelSel);

    labelMerge
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

    labelSel.exit().remove();
  }

  function scheduleSavePositions() {
    if (savePositionTimer) clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
      const positions: GraphPositionEntry[] = simNodes.map((n) => ({
        path: n.path,
        x: n.x,
        y: n.y
      }));
      void invoke('save_graph_node_positions', { positions });
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
    render();
  });

  onMount(() => {
    rebuildClusterLookups();
    buildSimData(data);
    const svg = select(svgEl);
    svg.append('g').attr('class', 'graph-container');
    initSimulation();

    const resizeObserver = new ResizeObserver(() => render());
    resizeObserver.observe(containerEl);

    return () => {
      simulation?.stop();
      resizeObserver.disconnect();
      if (savePositionTimer) clearTimeout(savePositionTimer);
      if (entryDelayTimer) clearTimeout(entryDelayTimer);
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
        style="background: {clusterColor(getClusterColorIndex(tooltipNode.clusterId))}20; color: {clusterColor(getClusterColorIndex(tooltipNode.clusterId))}"
      >
        {getClusterLabel(tooltipNode.clusterId)}
      </div>
    </div>
  {/if}
</div>
