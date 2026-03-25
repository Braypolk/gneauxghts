import { curveCatmullRomClosed, line } from 'd3';
import type { ClusterBubble, GraphCluster, SimNode } from '$lib/types/graph';

const CLUSTER_COLORS = [
  '#78c8ff',
  '#f5b56b',
  '#9be37a',
  '#c7a6ff',
  '#ff8ca8',
  '#7be1d0'
];

const TEMPORAL_DECAY_HALF_LIFE_DAYS = 30;

type GraphPoint = [number, number];

export function clusterColor(colorIndex: number): string {
  return CLUSTER_COLORS[colorIndex % CLUSTER_COLORS.length];
}

export function nodeRadius(modifiedMillis: number): number {
  const now = Date.now();
  const daysSince = (now - modifiedMillis) / (1000 * 60 * 60 * 24);
  if (daysSince < 1) return 13.5;
  if (daysSince < 7) return 11;
  if (daysSince < 30) return 8.5;
  if (daysSince < 90) return 6.5;
  return 5;
}

export function temporalDecay(createdA: number, createdB: number, score: number): number {
  const daysBetween = Math.abs(createdA - createdB) / (1000 * 60 * 60 * 24);
  return score * Math.exp(-daysBetween / TEMPORAL_DECAY_HALF_LIFE_DAYS);
}

export function buildClusterAnchors(clusters: GraphCluster[], totalNodes: number) {
  const anchors = new Map<number, { x: number; y: number }>();
  if (clusters.length === 0) return anchors;

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const baseSpacing = Math.max(128, Math.sqrt(totalNodes) * 22);
  const sortedClusters = [...clusters].sort((a, b) => b.noteCount - a.noteCount);

  sortedClusters.forEach((cluster, index) => {
    const estimatedRadius = 52 + Math.sqrt(cluster.noteCount) * 19;
    const radialDistance =
      index === 0
        ? estimatedRadius * 0.22
        : baseSpacing * Math.sqrt(index) + estimatedRadius * 0.45;
    const angle = index * goldenAngle;

    anchors.set(cluster.id, {
      x: Math.cos(angle) * radialDistance * 0.95,
      y: Math.sin(angle) * radialDistance * 0.8
    });
  });

  return anchors;
}

export function buildClusterBubbles(
  nodes: SimNode[],
  clusters: GraphCluster[],
  useHomePositions = false
): ClusterBubble[] {
  const clusterNodes = new Map<number, SimNode[]>();
  for (const node of nodes) {
    const list = clusterNodes.get(node.clusterId) ?? [];
    list.push(node);
    clusterNodes.set(node.clusterId, list);
  }

  return clusters
    .map((cluster) => {
      const members = clusterNodes.get(cluster.id) ?? [];
      if (members.length === 0) return null;

      let cx = 0;
      let cy = 0;
      for (const member of members) {
        cx += useHomePositions ? member.homeX : member.x;
        cy += useHomePositions ? member.homeY : member.y;
      }
      cx /= members.length;
      cy /= members.length;

      let maxDist = 0;
      for (const member of members) {
        const memberX = useHomePositions ? member.homeX : member.x;
        const memberY = useHomePositions ? member.homeY : member.y;
        const dist = Math.hypot(memberX - cx, memberY - cy);
        if (dist > maxDist) {
          maxDist = dist;
        }
      }

      const radius = Math.max(maxDist * 1.15 + 20, 35 + members.length * 2);
      const blob = buildClusterBlob(members, cx, cy, radius, useHomePositions);

      return { ...cluster, cx, cy, radius, ...blob } as ClusterBubble;
    })
    .filter((bubble): bubble is ClusterBubble => bubble !== null);
}

export function getGraphBounds(
  nodes: SimNode[],
  clusters: GraphCluster[],
  useHomePositions = false
) {
  const bubbles = buildClusterBubbles(nodes, clusters, useHomePositions);

  if (bubbles.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const bubble of bubbles) {
      minX = Math.min(minX, bubble.minX - 28);
      minY = Math.min(minY, bubble.minY - 28);
      maxX = Math.max(maxX, bubble.maxX + 28);
      maxY = Math.max(maxY, bubble.maxY + 28);
    }

    return { minX, minY, maxX, maxY };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const radius = node.radius + 24;
    const x = useHomePositions ? node.homeX : node.x;
    const y = useHomePositions ? node.homeY : node.y;
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + radius);
  }

  return { minX, minY, maxX, maxY };
}

function smoothCircularValues(values: number[], iterations = 3): number[] {
  let current = values;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    current = current.map((_, index) => {
      const prev2 = current[(index - 2 + current.length) % current.length];
      const prev1 = current[(index - 1 + current.length) % current.length];
      const self = current[index];
      const next1 = current[(index + 1) % current.length];
      const next2 = current[(index + 2) % current.length];
      return (prev2 + prev1 * 2 + self * 3 + next1 * 2 + next2) / 9;
    });
  }
  return current;
}

function emphasizeCircularValues(values: number[], baseRadius: number, factor: number): number[] {
  return values.map((value) => {
    const emphasized = baseRadius + (value - baseRadius) * factor;
    return Math.max(baseRadius * 0.92, emphasized);
  });
}

function angularDelta(a: number, b: number): number {
  const raw = Math.abs(a - b) % (Math.PI * 2);
  return raw > Math.PI ? Math.PI * 2 - raw : raw;
}

function buildRadialBlobPoints(
  perimeterPoints: GraphPoint[],
  cx: number,
  cy: number,
  radius: number
): GraphPoint[] {
  const sampleCount = 56;
  const baseRadius = Math.max(radius * 0.5, 34);
  const angularWindow = 0.48;
  const annotatedPoints = perimeterPoints.map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    return {
      angle: Math.atan2(dy, dx),
      distance: Math.hypot(dx, dy)
    };
  });
  const radii = Array.from({ length: sampleCount }, (_, index) => {
    const theta = (index / sampleCount) * Math.PI * 2;
    let support = baseRadius;

    for (const point of annotatedPoints) {
      const delta = angularDelta(theta, point.angle);
      if (delta > angularWindow) {
        continue;
      }

      const falloff = Math.pow(Math.cos((delta / angularWindow) * (Math.PI / 2)), 2);
      const contribution = baseRadius + (point.distance - baseRadius) * falloff;

      if (contribution > support) {
        support = contribution;
      }
    }

    return support;
  });

  const smoothedRadii = smoothCircularValues(radii, 2);
  const emphasizedRadii = emphasizeCircularValues(smoothedRadii, baseRadius, 1.22);

  return emphasizedRadii.map((distance, index) => {
    const theta = (index / sampleCount) * Math.PI * 2;
    return [cx + Math.cos(theta) * distance, cy + Math.sin(theta) * distance];
  });
}

function makeBlobPath(points: GraphPoint[]): string {
  const blobLine = line<GraphPoint>()
    .curve(curveCatmullRomClosed.alpha(1))
    .x((point) => point[0])
    .y((point) => point[1]);
  return blobLine(points) ?? '';
}

function buildClusterBlob(
  members: SimNode[],
  cx: number,
  cy: number,
  radius: number,
  useHomePositions: boolean
) {
  const perimeterPoints: GraphPoint[] = [];

  for (const member of members) {
    const x = useHomePositions ? member.homeX : member.x;
    const y = useHomePositions ? member.homeY : member.y;
    const pad = member.radius + 20;

    perimeterPoints.push(
      [x - pad, y],
      [x - pad * 0.72, y - pad * 0.72],
      [x, y - pad],
      [x + pad * 0.72, y - pad * 0.72],
      [x + pad, y],
      [x + pad * 0.72, y + pad * 0.72],
      [x, y + pad],
      [x - pad * 0.72, y + pad * 0.72]
    );
  }

  const shapePoints = buildRadialBlobPoints(perimeterPoints, cx, cy, radius);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of shapePoints) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    path: makeBlobPath(shapePoints),
    minX,
    minY,
    maxX,
    maxY
  };
}
