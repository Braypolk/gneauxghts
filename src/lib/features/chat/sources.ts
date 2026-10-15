import type { ChatCitation, ChatReadSource } from './types';

export function normalizeSource(raw: ChatReadSource, index = 0): ChatCitation {
  const id = `${raw.kind}:${raw.noteId ?? raw.url ?? raw.title}:${raw.anchor ?? index}`;
  if (raw.kind === 'web' && raw.url) {
    return { id, kind: 'web' as const, label: raw.title, url: raw.url, excerpt: raw.excerpt || null };
  }
  return {
    id,
    kind: 'note' as const,
    label: raw.title,
    noteId: raw.noteId ?? '',
    notePath: raw.notePath ?? '',
    ...(raw.revision ? { revision: raw.revision } : {}),
    ...(raw.passage ? { passage: raw.passage } : {}),
    sectionLabel: raw.anchor ?? null,
    startLine: null,
    excerpt: raw.excerpt || null
  };
}
