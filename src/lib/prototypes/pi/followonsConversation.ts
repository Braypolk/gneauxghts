import { chatReasoningChoices } from '$lib/features/chat/chatConfiguration';
import type { ChatConversation, ChatModelCapabilities, ChatProvider } from '$lib/features/chat/types';

export function followonsReasoningMode(provider: ChatProvider, model: string, capabilities: ChatModelCapabilities) {
  const choices = chatReasoningChoices(provider, model, capabilities);
  if (choices.some(choice => choice.value === 'off')) return 'normal-control' as const;
  // The ordinary hosted custom-model composer has no reasoning selector. Only
  // an explicit Off-only capability default can justify leaving that draft as is;
  // first Send must still prove that the controller admitted Off.
  if (choices.length === 0 && capabilities.reasoningOptions?.length === 1
    && capabilities.reasoningOptions[0] === 'off' && capabilities.defaultReasoningEffort === 'off')
    return 'unsupported-off' as const;
  throw new Error('Follow-on model cannot configure Off reasoning through the normal composer');
}

export type FollowonsDraft = { title: string; provider: ChatProvider; model: string; vaultAccess: 'full'; reasoningEffort: 'off' };
export type FollowonsConversationControls = {
  focusChat(): Promise<void>;
  newChat(): Promise<void>;
  title(value: string): Promise<void>;
  model(provider: ChatProvider, model: string): Promise<void>;
  vault(value: 'full'): Promise<void>;
  reasoning(value: 'off', provider: ChatProvider, model: string): Promise<void>;
  send(content: string): Promise<void>;
  accepted(title: string, content: string): Promise<ChatConversation>;
};

/** First Send creates and selects the draft through the mounted controller.
 * A raw API-created chat is absent from its already-loaded picker snapshot. */
export async function acquireFollowonsConversation(controls: FollowonsConversationControls, draft: FollowonsDraft, firstWarmup: string) {
  // A mounted chat can coexist with an active note pane. The dock's New action
  // follows the active pane, so focus the chat before acquiring New Chat.
  await controls.focusChat();
  await controls.newChat();
  await controls.title(draft.title);
  await controls.model(draft.provider, draft.model);
  await controls.vault(draft.vaultAccess);
  await controls.reasoning(draft.reasoningEffort, draft.provider, draft.model);
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
