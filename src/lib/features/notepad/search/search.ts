import { invoke } from '@tauri-apps/api/core';
import type { RelatedNotesResponse, SearchItem } from '$lib/types/semantic';
import type {
  RetrievalContextResponse,
  RetrievalContextScope
} from '$lib/types/semantic';
import type { RecentTaskItem } from '$lib/features/notepad/model/types';
import { callWithDraft, computeDraftHash } from '$lib/features/notepad/search/draftRef';

export type SearchMode = 'current' | 'all' | 'chats' | 'everything';
export type SearchScope = 'notes' | 'chats' | 'everything';
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
  context: SearchContext,
  scope: SearchScope = mode === 'chats' ? 'chats' : mode === 'everything' ? 'everything' : 'notes'
) {
  const hash = computeDraftHash(context.currentMarkdown);
  return callWithDraft(
    context.currentPath,
    hash,
    context.currentMarkdown,
    (currentMarkdown, currentBodyHash) =>
      invoke<SearchItem[]>('search_notes_hybrid', {
        query,
        mode: 'all',
        scope,
        currentPath: context.currentPath,
        currentTitle: context.currentTitle,
        currentMarkdown,
        currentBodyHash,
        limit: 12
      })
  );
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

export interface RecentFocusBundle {
  recentNotes: SearchItem[];
  recentTasks: RecentTaskItem[];
}

export async function listRecentFocus(context: Pick<SearchContext, 'currentPath'>) {
  return invoke<RecentFocusBundle>('list_recent_focus', {
    limit: RECENT_ITEMS_LIMIT,
    currentPath: context.currentPath
  });
}

export async function getRelatedNotes(
  context: SearchContext,
  selectedText: string | null,
  limit = 4
) {
  const hash = computeDraftHash(context.currentMarkdown);
  return callWithDraft(
    context.currentPath,
    hash,
    context.currentMarkdown,
    (currentMarkdown, currentBodyHash) =>
      invoke<RelatedNotesResponse>('get_related_notes', {
        currentPath: context.currentPath,
        currentTitle: context.currentTitle,
        currentMarkdown,
        currentBodyHash,
        selectedText,
        limit
      })
  );
}

export async function retrieveNoteContext(
  scope: RetrievalContextScope,
  context: SearchContext,
  options: {
    query?: string | null;
    selectedText?: string | null;
    limit?: number;
  } = {}
) {
  const hash = computeDraftHash(context.currentMarkdown);
  return callWithDraft(
    context.currentPath,
    hash,
    context.currentMarkdown,
    (currentMarkdown, currentBodyHash) =>
      invoke<RetrievalContextResponse>('retrieve_note_context', {
        scope,
        query: options.query ?? null,
        currentPath: context.currentPath,
        currentTitle: context.currentTitle,
        currentMarkdown,
        currentBodyHash,
        selectedText: options.selectedText ?? null,
        limit: options.limit ?? 8
      })
  );
}
