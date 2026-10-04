import { vi } from 'vitest';
import type { ChatApi } from './api';
import type { ChatAgentProposal, ChatConversation, ChatEventMap, ChatMessage, ChatSettings } from './types';

export const settings: ChatSettings = {
  provider: 'openai',
  model: 'test-model',
  openaiModel: 'test-model',
  localModel: '',
  localBaseUrl: 'http://localhost:1234/v1',
  reasoningEffort: 'medium',
  serviceTier: 'standard',
  webAccess: 'auto',
  defaultVaultAccess: 'approved',
  atlasVisibility: 'hidden'
};

export function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    role: 'assistant',
    content: '',
    status: 'streaming',
    createdAtMillis: 1,
    updatedAtMillis: 1,
    requestId: 'request-1',
    errorMessage: null,
    citations: [],
    attachments: [],
    linkTarget: 'Chats/Test/Part 001#^msg_message-1',
    parts: [{ id: 'text', type: 'text', text: '' }],
    agentRunId: null,
    agentSequence: 0,
    agentEventCreatedAtMillis: 0,
    agentRetiredRunIds: [],
    ...overrides
  };
}

export function conversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'conversation-1',
    title: 'Test conversation',
    status: 'active',
    vaultAccess: 'approved',
    createdAtMillis: 1,
    updatedAtMillis: 1,
    messageCount: 0,
    lastMessagePreview: null,
    provider: 'openai',
    model: 'test-model',
    reasoningEffort: 'medium',
    messages: [],
    activeRequestId: null,
    projectionPath: null,
    excerptMessageIds: {},
    ...overrides
  };
}

export const forgottenChat = {
  forgottenPath: '/vault/.forgotten/2026-07-28-chat',
  originalPath: '/vault/Chats/2026-07-28-chat',
  title: 'Test conversation',
  fileName: '2026-07-28-chat',
  forgottenAtMillis: 1,
  purgeAfterDays: 7 as const,
  purgeAtMillis: 2,
  kind: 'chat' as const,
  conversationId: 'conversation-1'
};

export function proposal(overrides: Partial<ChatAgentProposal> = {}): ChatAgentProposal {
  return {
    id: 'proposal-1',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'message-1',
    kind: 'update',
    noteId: 'note-1',
    suggestedPath: null,
    title: 'Project plan',
    baseHash: 'hash-1',
    payload: {},
    preview: { proposedEditorMarkdown: '# Project plan\n\nNext' },
    status: 'pending',
    createdAtMillis: 1,
    updatedAtMillis: 1,
    ...overrides
  };
}

export function fakeApi() {
  const handlers = new Map<keyof ChatEventMap, Set<(payload: never) => void>>();
  const api = {
    getComposerDraft: vi.fn<ChatApi['getComposerDraft']>(async () => ''),
    setComposerDraft: vi.fn<ChatApi['setComposerDraft']>(async () => undefined),
    findConversationByProjectionPath: vi.fn<ChatApi['findConversationByProjectionPath']>(async () => null),
    suggestContext: vi.fn<ChatApi['suggestContext']>(async () => { throw new Error('Unconfigured ChatApi call: suggestContext'); }),
    searchNotesForPolicy: vi.fn<ChatApi['searchNotesForPolicy']>(async () => []),
    getSettings: vi.fn<ChatApi['getSettings']>(async () => settings),
    setDefaults: vi.fn<ChatApi['setDefaults']>(async () => settings),
    setAtlasVisibility: vi.fn<ChatApi['setAtlasVisibility']>(async () => undefined),
    getKeyStatus: vi.fn<ChatApi['getKeyStatus']>(async () => { throw new Error('Unconfigured ChatApi call: getKeyStatus'); }),
    setApiKey: vi.fn<ChatApi['setApiKey']>(async () => { throw new Error('Unconfigured ChatApi call: setApiKey'); }),
    createConversation: vi.fn<ChatApi['createConversation']>(async () => conversation()),
    listConversations: vi.fn<ChatApi['listConversations']>(async () => [conversation()]),
    getConversation: vi.fn<ChatApi['getConversation']>(async () => conversation()),
    branchFromMessage: vi.fn<ChatApi['branchFromMessage']>(async () => conversation({ id: 'chat-branch' })),
    renameConversation: vi.fn<ChatApi['renameConversation']>(async () => { throw new Error('Unconfigured ChatApi call: renameConversation'); }),
    archiveConversation: vi.fn<ChatApi['archiveConversation']>(async () => forgottenChat),
    setConversationVaultAccess: vi.fn<ChatApi['setConversationVaultAccess']>(async (_id, vaultAccess) => {
      const { messages, activeRequestId, projectionPath, excerptMessageIds, ...summary } =
        conversation({ vaultAccess });
      return summary;
    }),
    setConversationProvider: vi.fn<ChatApi['setConversationProvider']>(async (_id, provider, model, reasoningEffort) => {
      const { messages, activeRequestId, projectionPath, excerptMessageIds, ...summary } =
        conversation({ provider, model, reasoningEffort });
      return summary;
    }),
    listOpenAiModels: vi.fn<ChatApi['listOpenAiModels']>(async () => []),
    listLocalModels: vi.fn<ChatApi['listLocalModels']>(async () => []),
    getModelCapabilities: vi.fn<ChatApi['getModelCapabilities']>(async () => ({
      images: true,
      audio: false,
      video: false,
      files: true,
      acceptedMimeTypes: ['image/png', 'text/plain', 'application/pdf'],
      tools: true,
    })),
    setLocalModelCapabilities: vi.fn<ChatApi['setLocalModelCapabilities']>(async (_model, capabilities) => capabilities),
    sendMessage: vi.fn<ChatApi['sendMessage']>(async () => { throw new Error('Unconfigured ChatApi call: sendMessage'); }),
    cancelRequest: vi.fn<ChatApi['cancelRequest']>(async () => undefined),
    decidePermission: vi.fn<ChatApi['decidePermission']>(async () => 'allowedOnce'),
    retryMessage: vi.fn<ChatApi['retryMessage']>(async () => { throw new Error('Unconfigured ChatApi call: retryMessage'); }),
    createExcerpt: vi.fn<ChatApi['createExcerpt']>(async () => { throw new Error('Unconfigured ChatApi call: createExcerpt'); }),
    rememberExcerpt: vi.fn<ChatApi['rememberExcerpt']>(async () => { throw new Error('Unconfigured ChatApi call: rememberExcerpt'); }),
    unrememberExcerpt: vi.fn<ChatApi['unrememberExcerpt']>(async () => { throw new Error('Unconfigured ChatApi call: unrememberExcerpt'); }),
    listGrants: vi.fn<ChatApi['listGrants']>(async () => []),
    listNotePolicies: vi.fn<ChatApi['listNotePolicies']>(async () => []),
    grantNote: vi.fn<ChatApi['grantNote']>(async (noteId) => ({ noteId, notePath: 'Ideas.md', noteTitle: 'Ideas', grantedAtMillis: 2 })),
    revokeNote: vi.fn<ChatApi['revokeNote']>(async () => undefined),
    setNoteExcluded: vi.fn<ChatApi['setNoteExcluded']>(async () => undefined),
    listPendingProposals: vi.fn<ChatApi['listPendingProposals']>(async () => []),
    commitAgentProposal: vi.fn<ChatApi['commitAgentProposal']>(async () => ({
      status: 'committed' as const,
      applied: { kind: 'updateNote', path: '/vault/Plan.md', previousPath: '/vault/Plan.md' },
      noteId: 'note-1',
      message: null
    })),
    dismissAgentProposal: vi.fn<ChatApi['dismissAgentProposal']>(async () => { throw new Error('Unconfigured ChatApi call: dismissAgentProposal'); }),
    resolveProjectionConflict: vi.fn<ChatApi['resolveProjectionConflict']>(async () => { throw new Error('Unconfigured ChatApi call: resolveProjectionConflict'); }),
    on: vi.fn<ChatApi['on']>(async (event, handler) => {
      const subscriptions = handlers.get(event) ?? new Set<(payload: never) => void>();
      subscriptions.add(handler);
      handlers.set(event, subscriptions);
      return () => {
        subscriptions.delete(handler);
        if (subscriptions.size === 0) handlers.delete(event);
      };
    })
  } satisfies ChatApi;
  return {
    api,
    emit<K extends keyof ChatEventMap>(event: K, payload: ChatEventMap[K]) {
      for (const handler of handlers.get(event) ?? []) handler(payload as never);
    },
    handlers
  };
}
