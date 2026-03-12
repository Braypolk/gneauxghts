import { writable } from 'svelte/store';

export interface ActiveNoteDraft {
  path: string | null;
  markdown: string;
}

export interface NoteOpenRequest {
  id: number;
  notePath: string;
  sectionLabel?: string | null;
  matchText?: string | null;
  startLine?: number | null;
  endLine?: number | null;
}

export const activeNoteDraft = writable<ActiveNoteDraft>({
  path: null,
  markdown: ''
});

export const noteOpenRequest = writable<NoteOpenRequest | null>(null);

export function requestNoteOpen(request: Omit<NoteOpenRequest, 'id'>) {
  noteOpenRequest.set({
    ...request,
    id: Date.now()
  });
}
