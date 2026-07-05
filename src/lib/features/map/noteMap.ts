import { invoke } from '@tauri-apps/api/core';

export interface NoteMapNote {
  noteId: string;
  notePath: string;
  fileName: string;
  title: string;
  sectionLabels: string[];
  excerpt: string;
  paragraphCount: number;
  taskCount: number;
  modifiedMillis: number;
}

export interface NoteMapEdge {
  sourceNotePath: string;
  targetNotePath: string;
  score: number;
}

export interface NoteMapPayload {
  notes: NoteMapNote[];
  edges: NoteMapEdge[];
  semanticAvailable: boolean;
}

export function loadNoteMap() {
  return invoke<NoteMapPayload>('get_note_map');
}
