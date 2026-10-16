import type { ChatConversation, ChatProvider } from '$lib/features/chat/types';

export type FollowonsDraft = { title: string; provider: ChatProvider; model: string; vaultAccess: 'full'; reasoningEffort: 'off' };
export type FollowonsConversationControls = {
  newChat(): Promise<void>;
  title(value: string): Promise<void>;
  model(provider: ChatProvider, model: string): Promise<void>;
  vault(value: 'full'): Promise<void>;
  reasoning(value: 'off'): Promise<void>;
  send(content: string): Promise<void>;
  accepted(title: string, content: string): Promise<ChatConversation>;
};

/** First Send creates and selects the draft through the mounted controller.
 * A raw API-created chat is absent from its already-loaded picker snapshot. */
export async function acquireFollowonsConversation(controls: FollowonsConversationControls, draft: FollowonsDraft, firstWarmup: string) {
  await controls.newChat();
  await controls.title(draft.title);
  await controls.model(draft.provider, draft.model);
  await controls.vault(draft.vaultAccess);
  await controls.reasoning(draft.reasoningEffort);
  await controls.send(firstWarmup);
  const conversation = await controls.accepted(draft.title, firstWarmup);
  if (conversation.title !== draft.title || conversation.provider !== draft.provider || conversation.model !== draft.model
    || conversation.vaultAccess !== draft.vaultAccess || conversation.reasoningEffort !== draft.reasoningEffort)
    throw new Error('First follow-on Send did not preserve the configured draft');
  if (!conversation.messages.some(message => message.role === 'user' && message.content === firstWarmup)
    || conversation.messages.at(-1)?.role !== 'assistant' || conversation.messages.at(-1)?.status !== 'completed')
    throw new Error('First follow-on WARMUP did not complete through the mounted composer');
  return conversation;
}
