export interface GraphNode {
  path: string;
  title: string;
  snippet: string;
  clusterId: number;
  createdAtMillis: number;
  modifiedMillis: number;
  xHint: number | null;
  yHint: number | null;
}

export interface GraphCluster {
  id: number;
  label: string;
  noteCount: number;
  colorIndex: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  score: number;
}

export interface WikilinkEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  clusters: GraphCluster[];
  wikilinkEdges: WikilinkEdge[];
  inferredEdges: GraphEdge[];
  timeRange: [number, number];
}

export interface GraphDataMetadata {
  semanticRevision: number;
  notesRevision: number;
  colorGroupCount: number;
  invalidationEpoch: number;
  refreshed: boolean;
}

export interface GraphPositionEntry {
  path: string;
  x: number;
  y: number;
}

export interface SimNode extends GraphNode {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  radius: number;
  shortTitle: string;
  titleLower: string;
  snippetLower: string;
}

export interface SimLink {
  source: SimNode;
  target: SimNode;
  type: 'wikilink' | 'inferred';
  score: number;
  weight: number;
}

export interface ClusterBubble {
  id: number;
  label: string;
  noteCount: number;
  colorIndex: number;
  cx: number;
  cy: number;
  radius: number;
  path: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
