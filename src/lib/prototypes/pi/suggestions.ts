import { invoke } from '@tauri-apps/api/core';
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatContextSuggestionResponse } from '$lib/features/chat/types';

/** Names are discovery metadata. Selection and canonical reads admit their own scope. */
export async function suggestPiContext(input: Parameters<ChatApi['suggestContext']>[0]): Promise<ChatContextSuggestionResponse> {
  const limit = Number.isFinite(input.limit) ? Math.max(0, Math.min(20, Math.floor(input.limit!))) : 4;
  const reason = 'Canonical titles only; suggestions contain no excerpts or read evidence.';
  if (!limit) return { status: 'ready', reason, items: [] };
  const discovered = await invoke<{ items: Array<{ noteId: string; title: string }>; hasMore?: boolean }>('pi_discover_notes', { query: input.query });
  const items = discovered.items.filter(item => item.noteId !== input.excludeNoteId).slice(0, limit).map(item => ({
    noteId: item.noteId, title: item.title, sectionLabel: null, excerpt: '', startLine: null, endLine: null, blockAnchor: null, reason: 'related' as const
  }));
  return { status: 'ready', reason: discovered.hasMore ? `${reason} Results are limited; narrow the title query for more.` : reason, items };
}
