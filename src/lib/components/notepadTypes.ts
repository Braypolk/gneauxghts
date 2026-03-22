export interface NoteSession {
  markdown: string;
  path: string | null;
}

export interface StoredImageAsset {
  fileName: string;
  filePath: string;
}

export interface RecentTaskItem {
  taskKey: string;
  notePath: string;
  noteTitle: string;
  text: string;
  lineNumber: number;
  updatedAtMillis: number;
}

export interface ResolvedNoteLink {
  notePath: string;
  sectionLabel: string;
  matchText: string;
}

export interface NoteLinkSuggestion {
  kind: 'note' | 'section';
  value: string;
  label: string;
  detail: string;
}
