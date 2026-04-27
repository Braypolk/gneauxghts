import { invoke } from '@tauri-apps/api/core';
import type { RelatedNotesResponse, SearchItem } from '$lib/types/semantic';
import type { RecentTaskItem } from '$lib/features/notepad/model/types';

export type SearchMode = 'current' | 'all';
const RECENT_ITEMS_LIMIT = 20;

export interface SearchContext {
  currentPath: string | null;
  currentTitle: string;
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
  mode: SearchMode,
  context: SearchContext
) {
  return invoke<SearchItem[]>('search_notes_hybrid', {
    query,
    mode,
    currentPath: context.currentPath,
    currentTitle: context.currentTitle,
    currentMarkdown: context.currentMarkdown,
    limit: 12
  });
}

export async function listRecentNotes(context: Pick<SearchContext, 'currentPath'>) {
  return invoke<SearchItem[]>('list_recent_notes', {
    limit: RECENT_ITEMS_LIMIT,
    currentPath: context.currentPath
  });
}

export async function listRecentTasks() {
  return invoke<RecentTaskItem[]>('list_recent_tasks', {
    limit: RECENT_ITEMS_LIMIT
  });
}

export async function getRelatedNotes(
  context: SearchContext,
  selectedText: string | null,
  limit = 4
) {
  return invoke<RelatedNotesResponse>('get_related_notes', {
    currentPath: context.currentPath,
    currentTitle: context.currentTitle,
    currentMarkdown: context.currentMarkdown,
    selectedText,
    limit
  });
}
