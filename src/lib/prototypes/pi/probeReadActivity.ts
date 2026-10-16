import type { ChatMessage } from '$lib/features/chat/types';

/** Correlate visible read activity with the same admitted answer and Note Identity. */
export function admittedProbeRead(message: ChatMessage, noteId: string) {
  if (!message.citations.some(source => source.kind === 'note' && source.noteId === noteId)) throw new Error('Allowed answer lacks the expected admitted Note Identity');
  for (const part of message.parts) {
    if (part.type !== 'tool' || part.status !== 'success' || part.title !== 'Read note evidence') continue;
    const source = part.readSources?.find(source => source.noteId === noteId);
    if (source) return source;
  }
  throw new Error('Allowed answer lacks successful actual read activity for the expected Note Identity');
}

export async function revealProbeReadActivity(input: {
  message: ChatMessage;
  noteId: string;
  until<V>(read: () => V | Promise<V>, label: string): Promise<NonNullable<V>>;
}) {
  const source = admittedProbeRead(input.message, input.noteId);
  const root = await input.until(() => document.querySelector(`[data-chat-message-id="${input.message.id}"]`), 'allowed answer activity message');
  const toggle = await input.until(() => Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-label^="Activity,"]')).find(node => !node.disabled), 'allowed answer normal Activity toggle');
  if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
  const expectedLabel = `Open ${source.label}${source.passage ? ', read passage' : ''}`;
  const readButton = await input.until(() => root.textContent?.includes('Read note evidence') ? Array.from(root.querySelectorAll<HTMLButtonElement>('[aria-label="Notes and passages read"] button'))
    .find(node => !node.disabled && node.getAttribute('aria-label') === expectedLabel && node.textContent?.trim() === source.label) : undefined, 'expanded successful read source button');
  if (toggle.getAttribute('aria-expanded') !== 'true') throw new Error('Read Activity did not remain expanded');
  return { messageId: input.message.id, noteId: source.noteId, sourceLabel: source.label, readButtonLabel: readButton.getAttribute('aria-label'), activityLabel: toggle.getAttribute('aria-label') };
}
