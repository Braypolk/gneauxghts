import { invoke } from '@tauri-apps/api/core';
import type { RelatedNotesResponse, SearchItem } from '$lib/types/semantic';
import type { RecentTaskItem } from './notepadTypes';

export type NotepadSearchMode = 'current' | 'all';

export interface NotepadSearchContext {
  currentPath: string | null;
  currentMarkdown: string;
}

export function isKeywordResult(result: SearchItem) {
  return result.reasonLabels.includes('keyword');
}

export function isSemanticOnlyResult(result: SearchItem) {
  return result.reasonLabels.includes('semantic') && !isKeywordResult(result);
}

export async function searchNotes(
  query: string,
  mode: NotepadSearchMode,
  context: NotepadSearchContext
) {
  return invoke<SearchItem[]>('search_notes_hybrid', {
    query,
    mode,
    currentPath: context.currentPath,
    currentMarkdown: context.currentMarkdown,
    limit: 12
  });
}

export async function listRecentNotes(context: NotepadSearchContext) {
  return invoke<SearchItem[]>('list_recent_notes', {
    limit: 12,
    currentPath: context.currentPath,
    currentMarkdown: context.currentMarkdown
  });
}

export async function listRecentTasks() {
  return invoke<RecentTaskItem[]>('list_recent_tasks', {
    limit: 12
  });
}

export async function getRelatedNotes(
  context: NotepadSearchContext,
  selectedText: string | null,
  limit = 4
) {
  return invoke<RelatedNotesResponse>('get_related_notes', {
    currentPath: context.currentPath,
    currentMarkdown: context.currentMarkdown,
    selectedText,
    limit
  });
}
