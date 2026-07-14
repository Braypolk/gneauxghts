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
  documentKind: 'note' | 'chatIndex' | 'chatTranscript';
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  radius: number;
  cloudId: string | null;
  parentCloudId: string | null;
  childCloudId: string | null;
  clusterId: string | null;
  subclusterId: string | null;
  centrality: number;
  degree: number;
  importance: number;
  modifiedAtMillis: number;
  lastViewedAtMillis: number | null;
  createdAtMillis: number;
  updatedAtMillis: number;
  staleScore: number;
  preview: string;
  tags: string[];
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
  level: number;
  label: string | null;
  labelConfidence: number;
  noteCount: number;
  density: number;
  color: [number, number, number, number];
  centroid: [number, number];
  labelAnchor: [number, number];
  radius: number;
  hull: [number, number][];
  memberNodeIds: string[];
  coreNodeIds: string[];
  outlierNodeIds: string[];
  childCloudIds: string[];
  representativeNodeIds: string[];
}

export interface AtlasSearchResponse {
  status: VaultAtlasStatus;
  reason: string | null;
  query: string;
  generatedAtMillis: number;
  matches: AtlasSearchMatch[];
}

export interface AtlasSearchMatch {
  noteId: string | null;
  notePath: string;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  structuralScore: number;
  recencyScore: number;
  reasonLabels: string[];
}
