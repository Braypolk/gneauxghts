export type VaultAtlasStatus = 'ready' | 'empty' | 'building' | 'unavailable';
export type AtlasLinkKind = 'semantic' | 'wikilink';

export interface VaultAtlasResponse {
  worldLayout?: boolean;
  nameRevision?: number;
  status: VaultAtlasStatus;
  reason: string | null;
  revision: number;
  generatedAtMillis: number;
  structuralGeneration: string;
  labelGeneration: string | null;
  publishedAtMillis: number;
  stale: boolean;
  publishInProgress: boolean;
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
  documentKind: 'note';
  x: number;
  y: number;
  radius: number;
  cloudId: string | null;
  parentCloudId: string | null;
  childCloudId: string | null;
  clusterId: string | null;
  subclusterId: string | null;
  centrality: number;
  importance: number;
  lastViewedAtMillis: number | null;
  /** Backend-decayed opening weight; absent in older cached/fixture payloads. */
  effectiveOpenCount?: number | null;
  createdAtMillis: number;
  updatedAtMillis: number;
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
  userName?: string | null;
  familyId?: string | null;
  familyName?: string | null;
  id: string;
  parentId: string | null;
  level: number;
  label: string | null;
  /** pending = structural placeholder, topic = embedding topic; other sources are legacy artifacts */
  labelSource: 'pending' | 'topic' | 'keybert' | 'medoid' | 'user';
  noteCount: number;
  density: number;
  color: [number, number, number, number];
  centroid: [number, number];
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
  documentKind: AtlasNode['documentKind'];
  score: number;
  semanticScore: number;
  lexicalScore: number;
  structuralScore: number;
  reasonLabels: string[];
}

export interface AtlasCloudName {
  cloudId: string;
  userName: string | null;
  label: string | null;
  nameRevision: number;
}
