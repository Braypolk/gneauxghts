import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage as ChatMessageModel } from '../types';
import ChatMessage from './ChatMessage.svelte';

function message(role: 'assistant' | 'user'): ChatMessageModel {
  return {
    id: `${role}-message`,
    conversationId: 'conversation-1',
    role,
    content: '**Visible text**',
    status: 'completed',
    createdAtMillis: 1,
    updatedAtMillis: 1,
    requestId: null,
    errorMessage: null,
    citations: [],
    attachments: [],
    linkTarget: null,
    parts: [{ id: 'text', type: 'text', text: '**Visible text**' }],
    agentRunId: null,
    agentSequence: 0
  };
}

function renderMessage(role: 'assistant' | 'user') {
  const noop = () => undefined;
  return render(ChatMessage, {
    props: {
      message: message(role),
      activity: null,
      selected: null,
      selectedExcerpt: null,
      canInsertSelection: false,
      onPreviewAttachment: noop,
      onRetry: noop,
      onBranch: noop,
      onCopyMessage: noop,
      onCopySelection: noop,
      onCopyLink: noop,
      onInsertSelection: noop,
      onToggleRemember: noop
    }
  }).body;
}

describe('ChatMessage text rendering', () => {
  it('renders assistant text as Markdown', () => {
    const body = renderMessage('assistant');
    expect(body).toContain(
      '<strong>Visible text</strong>'
    );
    expect(body).toContain('aria-label="Copy message as Markdown"');
  });

  it('keeps user text literal', () => {
    const body = renderMessage('user');
    expect(body).toContain('**Visible text**');
    expect(body).not.toContain('<strong>Visible text</strong>');
  });
});
