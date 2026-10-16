import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ChatPanel from '$lib/features/chat/ChatPanel.svelte';
import { createChatController } from '$lib/features/chat/controller.svelte';
import { conversation, fakeApi, message, settings } from '$lib/features/chat/chatTestSupport';
import type { ChatConversation, ChatModelCapabilities, ChatProvider } from '$lib/features/chat/types';
import { acquireFollowonsConversation, followonsReasoningMode, type FollowonsConversationControls } from './followonsConversation';

const offOnly: ChatModelCapabilities = { images: false, audio: false, video: false, files: false, tools: true, acceptedMimeTypes: [], reasoningOptions: ['off'], defaultReasoningEffort: 'off' };

describe('mounted follow-on draft admission', () => {
  it('inactive actual ChatPanel keeps its header outside the hidden dockless composer', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    try {
      const body = render(ChatPanel, { props: { controller, autoInitialize: false, composerDock: { slot: null, expanded: false, onExpand: () => {} } } }).body;
      const wrapper = body.match(/<div[^>]*class="chat-composer-slot[^>]*>/)?.[0];
      expect(wrapper).toBeDefined();
      expect(wrapper).toMatch(/\bhidden(?:\s|=|>)/);
      expect(body.indexOf('aria-label="Chat title"')).toBeGreaterThan(-1);
      expect(body.indexOf('aria-label="Chat title"')).toBeLessThan(body.indexOf(wrapper!));
      expect(body.indexOf('aria-label="Message"')).toBeGreaterThan(body.indexOf(wrapper!));
    } finally { controller.dispose(); }
  });
  for (const provider of ['local', 'openai'] as ChatProvider[]) it(`${provider}: creates and selects first WARMUP despite a stale picker list`, async () => {
    const fake = fakeApi();
    const records = new Map<string, ChatConversation>([['existing', conversation({ id: 'existing', title: 'Already mounted chat' })]]);
    let sequence = 0;
    fake.api.getSettings.mockResolvedValue({ ...settings, provider: 'local', model: 'previous-model', localModel: 'previous-model' });
    fake.api.listConversations.mockImplementation(async () => [...records.values()]);
    fake.api.getConversation.mockImplementation(async id => records.get(id)!);
    fake.api.getModelCapabilities.mockResolvedValue(offOnly);
    fake.api.createConversation.mockImplementation(async input => {
      const value = conversation({ ...input, id: `created-${++sequence}` }); records.set(value.id, value); return value;
    });
    fake.api.sendMessage.mockImplementation(async input => {
      const userMessage = message({ id: 'first-user', conversationId: input.conversationId, role: 'user', content: input.content, status: 'completed' });
      const assistantMessage = message({ id: 'first-assistant', conversationId: input.conversationId, content: 'Synthetic warmup.', status: 'completed' });
      records.get(input.conversationId)!.messages = [userMessage, assistantMessage];
      return { requestId: 'first-request', conversationId: input.conversationId, userMessage, assistantMessage };
    });
    const controller = createChatController(fake.api);
    await controller.initialize('existing');
    const reasoningSetter = vi.spyOn(controller, 'setReasoningEffort');
    try {
      const unseen = await fake.api.createConversation({ title: 'API-created unseen picker item' });
      expect((await fake.api.listConversations()).some(item => item.id === unseen.id)).toBe(true);
      expect(controller.getSnapshot().conversations.some(item => item.id === unseen.id)).toBe(false);
      let activePane: 'note' | 'chat' = 'note';
      const actions: string[] = [];
      const controls: FollowonsConversationControls = {
        focusChat: async () => { actions.push('focus chat composer'); activePane = 'chat'; },
        newChat: async () => { expect(activePane).toBe('chat'); actions.push('New Chat'); controller.startNewConversation(); },
        title: async title => { controller.setConversationDraftTitle(title); },
        model: async (selected, model) => { await controller.setProvider(selected, model); },
        vault: async access => { await controller.setVaultAccess(access); },
        reasoning: async (effort, selected, model) => {
          const mode = followonsReasoningMode(selected, model, await fake.api.getModelCapabilities(selected, model));
          // Exercise the retained composer's actual selector contract, rather
          // than treating a missing control as permission to set metadata.
          const body = render(ChatPanel, { props: { controller, autoInitialize: false } }).body;
          if (mode === 'unsupported-off') expect(body).not.toContain('aria-label="Reasoning effort"');
          else {
            expect(body).toContain('aria-label="Reasoning effort"');
            await controller.setReasoningEffort(effort);
          }
        },
        send: async content => { expect((await controller.send({ content })).status).toBe('sent'); },
        accepted: async title => records.get(controller.getSnapshot().conversation!.id)!
      };
      const firstWarmup = `PI_FOLLOWONS:WARMUP:run_${provider}_0`;
      const accepted = await acquireFollowonsConversation(controls, { title: `Followons ${provider}`, provider, model: 'pi-native-fixture', vaultAccess: 'full', reasoningEffort: 'off' }, firstWarmup);
      expect(actions).toEqual(['focus chat composer', 'New Chat']);
      expect(accepted.id).not.toBe(unseen.id);
      expect(controller.getSnapshot().conversation?.id).toBe(accepted.id);
      expect(controller.getSnapshot().conversations.some(item => item.id === accepted.id)).toBe(true);
      expect(fake.api.createConversation).toHaveBeenLastCalledWith({ title: `Followons ${provider}`, provider, model: 'pi-native-fixture', vaultAccess: 'full', reasoningEffort: 'off' });
      expect(fake.api.sendMessage).toHaveBeenCalledOnce();
      expect(fake.api.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: accepted.id, content: firstWarmup }));
      expect(reasoningSetter).toHaveBeenCalledTimes(provider === 'local' ? 1 : 0);
    } finally { controller.dispose(); }
  });

  it('requires exact Off-only capability proof before accepting an unavailable selector', () => {
    expect(followonsReasoningMode('openai', 'pi-native-fixture', offOnly)).toBe('unsupported-off');
    expect(followonsReasoningMode('local', 'pi-native-fixture', offOnly)).toBe('normal-control');
    for (const capabilities of [
      { ...offOnly, reasoningOptions: undefined },
      { ...offOnly, reasoningOptions: ['off', 'on'] },
      { ...offOnly, defaultReasoningEffort: 'medium' },
      { ...offOnly, defaultReasoningEffort: undefined },
    ] satisfies ChatModelCapabilities[]) {
      expect(() => followonsReasoningMode('openai', 'pi-native-fixture', capabilities)).toThrow('cannot configure Off');
    }
    expect(() => followonsReasoningMode('openai', 'gpt-5.4', offOnly)).toThrow('cannot configure Off');
  });

  it.each([{ model: 'wrong-model' }, { reasoningEffort: 'medium' as const }, { provider: 'openai' as const }])('rejects a completed first Send with silently changed configuration %o', async changed => {
    const noop = async () => {};
    const controls: FollowonsConversationControls = { focusChat: noop, newChat: noop, title: noop, model: noop, vault: noop, reasoning: noop, send: noop,
      accepted: async () => conversation({ title: 'Followons', provider: 'local', model: 'pi-native-fixture', vaultAccess: 'full', reasoningEffort: 'off', ...changed, messages: [message({ role: 'user', content: 'warmup' }), message({ status: 'completed' })] }) };
    await expect(acquireFollowonsConversation(controls, { title: 'Followons', provider: 'local', model: 'pi-native-fixture', vaultAccess: 'full', reasoningEffort: 'off' }, 'warmup')).rejects.toThrow('configured draft');
  });
});
