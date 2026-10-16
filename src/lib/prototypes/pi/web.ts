import type { ChatReadSource } from '$lib/features/chat/types';

/** Authored web links are a separate inventory, never issued vault evidence. */
export function webSourcesFromText(content: string): ChatReadSource[] {
  const seen = new Set<string>();
  const sources: ChatReadSource[] = [];
  const urls = content.matchAll(/https?:\/\/[^\s)\]>"'`]+/g);
  for (const [raw] of urls) {
    const url = raw.replace(/[,.;:!]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    sources.push({ kind: 'web', title: url, excerpt: '', url,
      noteId: null, notePath: null, anchor: null, revision: null, passage: null });
  }
  return sources;
}

export const vaultSources = (sources: readonly ChatReadSource[]): ChatReadSource[] => sources.filter(source => source.kind !== 'web');
