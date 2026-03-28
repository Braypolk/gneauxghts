export interface NoteSession {
  noteId: string | null;
  title: string;
  markdown: string;
  path: string | null;
}

export interface StoredImageAsset {
  fileName: string;
  filePath: string;
}

export interface RecentTaskItem {
  noteId: string;
  taskKey: string;
  notePath: string;
  noteTitle: string;
  text: string;
  lineNumber: number;
  updatedAtMillis: number;
}

export interface ResolvedNoteLink {
  noteId: string;
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
