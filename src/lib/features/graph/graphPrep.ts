import { buildClusterAnchors, nodeRadius, temporalDecay } from '$lib/features/graph/graphLayout';
import type { GraphCluster, GraphData, SimLink, SimNode } from '$lib/types/graph';

const MAX_INFERRED_EDGES_TO_CONSIDER = 5_000;

export interface NodeRenderInfo {
  matchScore: number;
  inRange: boolean;
}

export interface ClusterLookups {
  colorIndexById: Map<number, number>;
  labelById: Map<number, string>;
  labelLowerById: Map<number, string>;
}

export interface GraphPrepConfig {
  inferredEdgeSimilarityThreshold: number;
  maxInferredEdgesPerNode: number;
  strongMatchScore: number;
  unknownClusterLabel: string;
  entryAnimationScale: number;
  entryAnimationJitter: number;
  entryBurstProbability: number;
  entrySwirlDistance: number;
  entrySwirlVelocity: number;
}

export function buildClusterLookups(clusters: GraphCluster[]): ClusterLookups {
  return {
    colorIndexById: new Map(clusters.map((cluster) => [cluster.id, cluster.colorIndex])),
    labelById: new Map(clusters.map((cluster) => [cluster.id, cluster.label])),
    labelLowerById: new Map(clusters.map((cluster) => [cluster.id, cluster.label.toLowerCase()]))
  };
}

export function getClusterColorIndex(clusterId: number, lookups: ClusterLookups): number {
  return lookups.colorIndexById.get(clusterId) ?? 0;
}

export function getClusterLabel(clusterId: number, lookups: ClusterLookups, fallback: string): string {
  return lookups.labelById.get(clusterId) ?? fallback;
}

export function createNodeRenderInfoMap(
  simNodes: SimNode[],
  {
    searchQuery,
    timeFilterRange,
    clusterLookups,
    strongMatchScore
  }: {
    searchQuery: string;
    timeFilterRange: [number, number] | null;
    clusterLookups: ClusterLookups;
    strongMatchScore: number;
  }
) {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return new Map<string, NodeRenderInfo>(
    simNodes.map((node) => [
      node.path,
      {
        matchScore: searchMatchScore(node, normalizedQuery, clusterLookups, strongMatchScore),
        inRange: isInTimeRange(node, timeFilterRange)
      }
    ])
  );
}

export function buildSimData(
  graphData: GraphData,
  config: GraphPrepConfig,
  random = Math.random
) {
  const nodeMap = new Map<string, SimNode>();
  const hasHints = hintsAreUsable(graphData.nodes);
  const clusterAnchors = buildClusterAnchors(graphData.clusters, graphData.nodes.length);
  const spreadRadius = Math.max(200, Math.sqrt(graphData.nodes.length) * 50);

  const simNodes = graphData.nodes.map((node) => {
    let targetX: number;
    let targetY: number;

    if (hasHints && node.xHint !== null && node.yHint !== null) {
      targetX = node.xHint;
      targetY = node.yHint;
    } else {
      const anchor = clusterAnchors.get(node.clusterId) ?? { x: 0, y: 0 };
      const jitter = Math.max(40, spreadRadius * 0.3);
      targetX = anchor.x + (random() - 0.5) * jitter;
      targetY = anchor.y + (random() - 0.5) * jitter;
    }

    const burst = random() < config.entryBurstProbability;
    const targetDistance = Math.hypot(targetX, targetY) || 1;
    const radialX = targetX / targetDistance;
    const radialY = targetY / targetDistance;
    const tangentX = -radialY;
    const tangentY = radialX;
    const swirlOffset = burst ? (random() - 0.5) * config.entrySwirlDistance : 0;
    const compressionScale = burst
      ? config.entryAnimationScale * (0.4 + random() * 0.9)
      : config.entryAnimationScale * (0.8 + random() * 0.3);
    const x =
      targetX * compressionScale +
      tangentX * swirlOffset +
      (random() - 0.5) * config.entryAnimationJitter;
    const y =
      targetY * compressionScale +
      tangentY * swirlOffset +
      (random() - 0.5) * config.entryAnimationJitter;
    const swirlVelocity = burst
      ? (random() - 0.5) * config.entrySwirlVelocity
      : (random() - 0.5) * 0.28;

    const simNode: SimNode = {
      ...node,
      x,
      y,
      homeX: targetX,
      homeY: targetY,
      vx: (targetX - x) * 0.02 + tangentX * swirlVelocity,
      vy: (targetY - y) * 0.02 + tangentY * swirlVelocity,
      fx: null,
      fy: null,
      radius: nodeRadius(node.modifiedMillis),
      shortTitle: node.title.length > 24 ? `${node.title.slice(0, 22)}...` : node.title,
      titleLower: node.title.toLowerCase(),
      snippetLower: node.snippet.toLowerCase()
    };
    nodeMap.set(node.path, simNode);
    return simNode;
  });

  const wikilinkSet = new Set<string>();
  const simLinks: SimLink[] = [];

  for (const edge of graphData.wikilinkEdges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (source && target) {
      const key = [edge.source, edge.target].sort().join('::');
      wikilinkSet.add(key);
      simLinks.push({ source, target, type: 'wikilink', score: 1, weight: 1 });
    }
  }

  const inferredCountPerNode = new Map<string, number>();
  const filteredInferred = graphData.inferredEdges
    .filter((edge) => edge.score >= config.inferredEdgeSimilarityThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INFERRED_EDGES_TO_CONSIDER);

  for (const edge of filteredInferred) {
    const key = [edge.source, edge.target].sort().join('::');
    if (wikilinkSet.has(key)) {
      continue;
    }

    const sourceCount = inferredCountPerNode.get(edge.source) ?? 0;
    const targetCount = inferredCountPerNode.get(edge.target) ?? 0;
    if (
      sourceCount >= config.maxInferredEdgesPerNode &&
      targetCount >= config.maxInferredEdgesPerNode
    ) {
      continue;
    }

    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (source && target) {
      const weight = temporalDecay(source.createdAtMillis, target.createdAtMillis, edge.score);
      simLinks.push({ source, target, type: 'inferred', score: edge.score, weight });
      inferredCountPerNode.set(edge.source, sourceCount + 1);
      inferredCountPerNode.set(edge.target, targetCount + 1);
    }
  }

  return {
    simNodes,
    simLinks
  };
}

function hintsAreUsable(nodes: GraphData['nodes']): boolean {
  const withHints = nodes.filter((node) => node.xHint !== null && node.yHint !== null);
  if (withHints.length < 2) return false;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of withHints) {
    if (node.xHint! < minX) minX = node.xHint!;
    if (node.xHint! > maxX) maxX = node.xHint!;
    if (node.yHint! < minY) minY = node.yHint!;
    if (node.yHint! > maxY) maxY = node.yHint!;
  }

  const span = Math.max(maxX - minX, maxY - minY);
  return span > 50;
}

function searchMatchScore(
  node: SimNode,
  normalizedQuery: string,
  clusterLookups: ClusterLookups,
  strongMatchScore: number
) {
  if (!normalizedQuery) return 1;
  if (node.titleLower.includes(normalizedQuery)) return 1;
  if (node.snippetLower.includes(normalizedQuery)) return strongMatchScore;
  if (clusterLookups.labelLowerById.get(node.clusterId)?.includes(normalizedQuery)) return 0.5;
  return 0;
}

function isInTimeRange(node: SimNode, timeFilterRange: [number, number] | null) {
  if (!timeFilterRange) return true;
  return (
    node.createdAtMillis >= timeFilterRange[0] &&
    node.createdAtMillis <= timeFilterRange[1]
  );
}
