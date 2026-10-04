import type { BrowserCommandOverrides } from './browserBackendContract';
import type { LocalModelCapabilitySelection } from '$lib/features/chat/types';

/** Isolated native-boundary responses for mounted chat controls; never calls a model. */
export function createChatControlsFixture(emit: (event: string, payload: unknown) => void): BrowserCommandOverrides {
  let settings = { provider: 'openai', model: 'gpt-5.6-sol', openaiModel: 'gpt-5.6-sol', localModel: 'fixture-local', localBaseUrl: 'http://localhost:1234/v1', defaultAccess: 'full', reasoningEffort: 'medium', serviceTier: 'standard', webAccess: 'off', atlasVisibility: 'hidden' };
  let created = false;
  let sequence = 0;
  let capabilities: LocalModelCapabilitySelection = { images: false, audio: false, video: false, tools: true, reasoningEffort: 'medium' };
  const drafts = new Map<string, string>();
  const summary = { id: 'controls-chat', title: 'Controls conversation', access: 'full', status: 'active', createdAtMillis: 1, updatedAtMillis: 1, messageCount: 0, detached: false, provider: 'openai', model: 'gpt-5.6-sol', reasoningEffort: 'medium' };
  return {
    chat_get_settings: () => settings,
    chat_set_defaults: args => { settings = { ...settings, ...args.defaults as Omit<typeof settings, 'atlasVisibility'> }; return settings; },
    chat_set_atlas_visibility: args => { settings.atlasVisibility = args.visibility as typeof settings.atlasVisibility; return null; },
    chat_get_key_status: () => ({ provider: 'openai', configured: false }),
    chat_list_conversations: () => created ? [summary] : [],
    chat_create_conversation: () => { created = true; return { ...summary, messages: [], excerpts: [] }; },
    chat_get_conversation: () => ({ ...summary, messages: [], excerpts: [] }),
    chat_get_composer_draft: args => drafts.get(String(args.slot)) ?? '',
    chat_set_composer_draft: args => { drafts.set(String(args.slot), String(args.body)); return null; },
    chat_list_grants: () => [],
    chat_list_note_policies: () => [],
    chat_list_pending_proposals: () => [],
    chat_list_openai_models: () => [],
    chat_list_local_models: () => [{ id: 'fixture-local', ownedBy: 'local' }],
    chat_get_model_capabilities: () => ({ ...capabilities, files: true, acceptedMimeTypes: [], defaultReasoningEffort: capabilities.reasoningEffort }),
    chat_set_local_model_capabilities: args => { capabilities = args.capabilities as LocalModelCapabilitySelection; return capabilities; },
    chat_suggest_context: () => ({ status: 'ready', items: [], reason: null }),
    chat_send_message: args => {
      const request = args.request as { content: string };
      sequence += 1;
      const identity = { requestId: `controls-request-${sequence}`, conversationId: summary.id, messageId: `controls-assistant-${sequence}` };
      emit('chat://started', identity);
      if (request.content === 'Permission scenario') {
        emit('chat://agent-event', { schemaVersion: 2, ...identity, runId: 'controls-run', sequence: 1, createdAtMillis: 1, event: { type: 'permissionRequested', request: { ...identity, permissionId: 'controls-permission', runId: 'controls-run', toolCallId: 'controls-call', toolName: 'fixture_tool', title: 'Fixture permission', kind: 'processExecution', scope: 'fixture' } } });
      } else {
        emit('chat://source', { ...identity, source: { kind: 'note', noteId: 'note-beta', notePath: '/e2e/beta.md', title: 'Beta note', excerpt: 'Beta body is independent from Alpha.' } });
        emit('chat://completed', { ...identity, content: 'Fixture answer with evidence.' });
      }
      return { requestId: identity.requestId, conversationId: summary.id, userMessageId: `controls-user-${sequence}`, assistantMessageId: identity.messageId };
    },
    chat_decide_permission: () => 'allowedOnce',
    chat_cancel_request: () => null
  };
}
