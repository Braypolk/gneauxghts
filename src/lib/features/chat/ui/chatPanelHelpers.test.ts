import { describe, expect, it } from 'vitest';
import type {
  ChatAgentProposal,
  ChatConversation,
  ChatSettings
} from '../types';
import {
  chatConversationContextKey,
  proposalInitialMarkdown,
  providerModel,
  renderChatMarkdown,
  resolveTargetMessageId,
  safeWebCitationHref
} from './chatPanelHelpers';

const settings: ChatSettings = {
  provider: 'openai',
  model: 'fallback-model',
  openaiModel: 'hosted-model',
  localModel: 'local-model',
  localBaseUrl: 'http://localhost:1234/v1',
  serviceTier: 'standard',
  webAccess: 'auto',
  defaultVaultAccess: 'full',
  atlasVisibility: 'hidden'
};

function conversation(): ChatConversation {
  return {
    id: 'chat-1',
    title: 'Chat',
    status: 'active',
    vaultAccess: 'full',
    createdAtMillis: 1,
    updatedAtMillis: 1,
    messageCount: 0,
    lastMessagePreview: null,
    provider: 'openai',
    model: 'hosted-model',
    messages: [],
    activeRequestId: null,
    projectionPath: null,
    excerptMessageIds: { excerpt: 'message-from-excerpt' }
  };
}

function proposal(preview: Record<string, unknown>): ChatAgentProposal {
  return {
    id: 'proposal-1',
    runId: 'run-1',
    conversationId: 'chat-1',
    assistantMessageId: 'message-1',
    kind: 'create',
    noteId: null,
    suggestedPath: 'Note.md',
    title: 'Note',
    baseHash: null,
    payload: {},
    preview,
    status: 'pending',
    createdAtMillis: 1,
    updatedAtMillis: 1
  };
}

describe('chat panel helpers', () => {
  it('uses stable context keys for conversations and unsaved drafts', () => {
    expect(chatConversationContextKey('chat-1', 2)).toBe('conversation:chat-1');
    expect(chatConversationContextKey(null, 2)).toBe('draft:2');
  });

  it('resolves direct message and remembered excerpt anchors', () => {
    expect(resolveTargetMessageId('^msg_message-1', conversation())).toBe('message-1');
    expect(resolveTargetMessageId('excerpt', conversation())).toBe('message-from-excerpt');
    expect(resolveTargetMessageId('missing', conversation())).toBeNull();
    expect(resolveTargetMessageId(null, conversation())).toBeNull();
  });

  it('selects the configured model for each provider', () => {
    expect(providerModel(settings, 'openai')).toBe('hosted-model');
    expect(providerModel(settings, 'local')).toBe('local-model');
    expect(providerModel(null, 'openai')).toBe('gpt-5.6-terra');
    expect(providerModel(null, 'local')).toBe('');
  });

  it('reads proposal markdown only when the preview contains a string', () => {
    expect(proposalInitialMarkdown(proposal({ proposedEditorMarkdown: '# Draft' }))).toBe(
      '# Draft'
    );
    expect(proposalInitialMarkdown(proposal({ proposedEditorMarkdown: 42 }))).toBe('');
    expect(proposalInitialMarkdown(proposal({}))).toBe('');
  });

  it('allows only absolute HTTP and HTTPS citation URLs', () => {
    expect(safeWebCitationHref('https://example.com/path')).toBe(
      'https://example.com/path'
    );
    expect(safeWebCitationHref('http://example.com')).toBe('http://example.com/');
    expect(safeWebCitationHref('javascript:alert(1)')).toBe('#');
    expect(safeWebCitationHref('/relative')).toBe('#');
    expect(safeWebCitationHref('not a url')).toBe('#');
  });

  it('renders Markdown while escaping raw HTML', () => {
    expect(renderChatMarkdown('**Bold**')).toContain('<strong>Bold</strong>');
    expect(renderChatMarkdown('<script>alert(1)</script>')).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });
});
