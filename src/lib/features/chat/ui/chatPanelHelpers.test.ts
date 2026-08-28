import { describe, expect, it } from 'vitest';
import type {
  ChatAgentProposal,
  ChatConversation
} from '../types';
import {
  chatConversationContextKey,
  proposalInitialMarkdown,
  resolveTargetMessageId,
  safeWebCitationHref
} from './chatPanelHelpers';

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
    reasoningEffort: 'medium',
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
});
