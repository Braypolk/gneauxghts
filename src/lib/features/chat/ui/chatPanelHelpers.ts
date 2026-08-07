import MarkdownIt from 'markdown-it';
import type {
  ChatAgentProposal,
  ChatConversation
} from '../types';

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderChatMarkdown(content: string) {
  return markdown.render(content);
}

export function chatConversationContextKey(
  conversationId: string | null | undefined,
  draftRevision: number
) {
  return conversationId
    ? `conversation:${conversationId}`
    : `draft:${draftRevision}`;
}

/**
 * Where unsent composer text is stored. A conversation owns its own draft; a
 * chat pane that has not created a conversation yet owns the draft itself.
 * Returns null when the host did not give the pane a durable identity.
 */
export function chatComposerDraftSlot(
  conversationId: string | null | undefined,
  paneDraftSlot: string | null | undefined
) {
  if (conversationId) return `conversation:${conversationId}`;
  return paneDraftSlot ?? null;
}

export function resolveTargetMessageId(
  targetAnchor: string | null | undefined,
  conversation: ChatConversation | null
) {
  const anchor = targetAnchor?.replace(/^\^/, '') ?? '';
  if (!anchor || !conversation) return null;
  return anchor.startsWith('msg_')
    ? anchor.slice(4) || null
    : conversation.excerptMessageIds[anchor] ?? null;
}

export function proposalInitialMarkdown(proposal: ChatAgentProposal) {
  const preview = proposal.preview as { proposedEditorMarkdown?: unknown };
  return typeof preview.proposedEditorMarkdown === 'string'
    ? preview.proposedEditorMarkdown
    : '';
}

/** Absolute http(s) href for web citations — not an app route, so no resolve(). */
export function safeWebCitationHref(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '#';
    return parsed.href;
  } catch {
    return '#';
  }
}
