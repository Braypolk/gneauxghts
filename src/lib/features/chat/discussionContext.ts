export interface ChatDraftSeed {
  id: string;
  text: string;
}

export function formatDiscussionDraft(selectedText: string, noteTitle = ''): string {
  const quote = selectedText
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  const source = noteTitle.trim() ? ` from “${noteTitle.trim()}”` : '';
  return `Help me think through this passage${source}:\n\n${quote}`;
}

export function mergeDiscussionDraft(currentDraft: string, context: string): string {
  const current = currentDraft.trim();
  const next = context.trim();
  if (!current) return next;
  if (!next) return current;
  return `${current}\n\n${next}`;
}
