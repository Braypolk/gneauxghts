import { describe, expect, it } from 'vitest';
import {
  chatConversationContextKey,
  proposalInitialMarkdown,
  resolveTargetMessageId,
  safeWebCitationHref
} from './chatPanelHelpers';

describe('chat panel helpers', () => {
  it('uses stable context keys for conversations and unsaved drafts', () => {
    expect(chatConversationContextKey('chat-1', 2)).toBe('conversation:chat-1');
    expect(chatConversationContextKey(null, 2)).toBe('draft:2');
  });

  it('resolves direct message and remembered excerpt anchors', () => {
    const conversation = { excerptMessageIds: { excerpt: 'message-from-excerpt' } };
    expect(resolveTargetMessageId('^msg_message-1', conversation)).toBe('message-1');
    expect(resolveTargetMessageId('excerpt', conversation)).toBe('message-from-excerpt');
    expect(resolveTargetMessageId('missing', conversation)).toBeNull();
    expect(resolveTargetMessageId(null, conversation)).toBeNull();
  });

  it('reads proposal markdown only when the preview contains a string', () => {
    expect(proposalInitialMarkdown({ preview: { proposedEditorMarkdown: '# Draft' } })).toBe(
      '# Draft'
    );
    expect(proposalInitialMarkdown({ preview: { proposedEditorMarkdown: 42 } })).toBe('');
    expect(proposalInitialMarkdown({ preview: {} })).toBe('');
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
