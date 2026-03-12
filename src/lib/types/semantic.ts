export interface SemanticSettings {
  semanticSearchEnabled: boolean;
  relatedSidebarEnabled: boolean;
  localOnlyMode: boolean;
  autoDownloadModel: boolean;
  lexicalWeight: number;
  semanticWeight: number;
  graphMinScore: number;
  strongestLinksOnly: boolean;
}

export interface SemanticModelInfo {
  id: string;
  label: string;
  dimensions: number;
  localOnly: boolean;
  autoDownloadSupported: boolean;
}

export interface SemanticIndexJob {
  id: number;
  status: string;
  scannedCount: number;
  embeddedCount: number;
  errorText: string | null;
  startedAtMillis: number;
  updatedAtMillis: number;
}

export interface SemanticStatus {
  settings: SemanticSettings;
  model: SemanticModelInfo;
  modelAvailable: boolean;
  indexingPaused: boolean;
  indexingInProgress: boolean;
  indexedNotes: number;
  indexedChunks: number;
  lastIndexedAtMillis: number | null;
  lastError: string | null;
  currentJobLabel: string | null;
  latestJob: SemanticIndexJob | null;
}

export interface SearchItem {
  notePath: string | null;
  fileName: string;
  sectionLabel: string;
  excerpt: string;
  highlightRanges: { start: number; end: number }[];
  matchText: string;
  reasonLabels: string[];
  lexicalScore: number | null;
  semanticScore: number | null;
  startLine: number | null;
  endLine: number | null;
}

export interface RelatedItem {
  notePath: string;
  noteTitle: string;
  excerpt: string;
  matchText: string;
  sectionLabel: string | null;
  score: number;
  reasonLabel: string;
  startLine: number;
  endLine: number;
}

export interface MapNode {
  notePath: string;
  title: string;
  degree: number;
  x: number;
  y: number;
}

export interface MapEdge {
  sourceNotePath: string;
  targetNotePath: string;
  score: number;
}

export interface MapGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  minScore: number;
}
