/** Synthetic restored history; no model calls, credentials, or user messages. */
export function chatHistoryFixture(count = 100) {
  const summary = {
    id: 'motion-chat', title: 'Populated motion fixture', access: 'full', status: 'active',
    createdAtMillis: 1_800_000_000_000, updatedAtMillis: 1_800_000_000_000,
    messageCount: count, detached: false, provider: 'openai', model: 'fixture', reasoningEffort: 'medium'
  };
  const messages = Array.from({ length: count }, (_, i) => ({
    id: `motion-${i}`, conversationId: summary.id, ordinal: i, role: i % 2 ? 'assistant' : 'user',
    status: 'complete',
    content: i % 2
      ? ('## Example response\n\n' + 'Some example words that wrap and are laid out within the conversation. '.repeat(20) + '\n\n- First item\n- Second item\n\n').repeat(3)
      : 'Could you explain this note?',
    part: 1, createdAtMillis: summary.createdAtMillis + i, sources: []
  }));
  return { ...summary, excerpts: [], messages };
}
