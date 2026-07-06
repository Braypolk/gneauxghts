export type VaultAtlasStatus = 'ready' | 'empty' | 'building' | 'unavailable';
export type AtlasLinkKind = 'semantic' | 'wikilink';

export interface VaultAtlasResponse {
  status: VaultAtlasStatus;
  reason: string | null;
  revision: number;
  generatedAtMillis: number;
  stats: {
    noteCount: number;
    cloudCount: number;
    linkCount: number;
    isolatedCount: number;
  };
  nodes: AtlasNode[];
  links: AtlasLink[];
  clouds: AtlasCloud[];
}

export interface AtlasNode {
  id: string;
  noteId: string | null;
  notePath: string;
  title: string;
  fileName: string;
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  radius: number;
  cloudId: string | null;
  parentCloudId: string | null;
  centrality: number;
  modifiedAtMillis: number;
  lastViewedAtMillis: number | null;
  staleScore: number;
  isolated: boolean;
}

export interface AtlasLink {
  id: string;
  sourceId: string;
  targetId: string;
  kind: AtlasLinkKind;
  score: number;
  strength: number;
}

export interface AtlasCloud {
  id: string;
  parentId: string | null;
  label: string | null;
  labelConfidence: number;
  noteCount: number;
  density: number;
  centroid: [number, number];
  hull: [number, number][];
  memberNodeIds: string[];
  representativeNodeIds: string[];
}
