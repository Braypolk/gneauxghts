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
    agentSequence: 0,
    agentEventCreatedAtMillis: 0,
    agentRetiredRunIds: []
  };
}

function renderMessage(
  role: 'assistant' | 'user',
  overrides: Partial<ChatMessageModel> = {},
  canDecidePermission = false
) {
  const noop = () => undefined;
  return render(ChatMessage, {
    props: {
      message: { ...message(role), ...overrides },
      activity: null,
      selected: null,
      selectedExcerpt: null,
      canInsertSelection: false,
      canDecidePermission,
      onPreviewAttachment: noop,
      onRetry: noop,
      onBranch: noop,
      onCopyMessage: noop,
      onCopySelection: noop,
      onCopyLink: noop,
      onInsertSelection: noop,
      onToggleRemember: noop,
      onDecidePermission: noop,
      onReviewProposal: noop
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

  it('renders observable runtime states with accessible labels and no private reasoning', () => {
    const body = renderMessage('assistant', {
      status: 'streaming',
      parts: [
        { id: 'text', type: 'text', text: '**Visible text**' },
        {
          id: 'tool:read', type: 'tool', callId: 'read', name: 'read_note',
          title: 'Read note', status: 'running'
        },
        {
          id: 'plan', type: 'plan',
          entries: [{ id: 'step-1', text: 'Inspect notes', status: 'inProgress' }]
        },
        {
          id: 'retry', type: 'status', status: 'retrying', turn: 2,
          label: 'Model turn 2 retried'
        }
      ]
    });

    expect(body).toContain('aria-label="Activity, 0 of 1 actions complete. Toggle details"');
    expect(body).toContain('Model turn 2 retried');
    expect(body).toContain('Inspect notes');
    expect(body).not.toContain('Step 1');
    expect(body).not.toContain('private reasoning payload');
  });

  it('derives durable sources and the branch checkpoint from message evidence and status', () => {
    const body = renderMessage('assistant', {
      content: 'Supported by [Example](https://example.com).',
      citations: [{
        id: 'web:example', kind: 'web', label: 'Example',
        url: 'https://example.com', excerpt: 'Evidence'
      }]
    });

    expect(body).toContain('1 source');
    expect(body).toContain('Example');
    expect(body).toContain('data-chat-citation-id="web:example"');
    expect(body).toContain('aria-label="Source 1: Example"');
    expect(body).toContain('aria-label="Branch from here"');
  });

  it('renders accessible permission controls and a clear run-scoped grant label', () => {
    const body = renderMessage('assistant', {
      status: 'streaming',
      requestId: 'request-1',
      agentRunId: 'run-1',
      parts: [{
        id: 'permission:permission-1', type: 'permission', status: 'pending',
        request: {
          permissionId: 'permission-1', requestId: 'request-1',
          conversationId: 'conversation-1', messageId: 'assistant-message', runId: 'run-1',
          toolCallId: 'call-1', toolName: 'fake_side_effect',
          title: 'Run fake side effect', kind: 'processExecution', scope: 'command:echo'
        }
      }]
    }, true);
    expect(body).toContain('aria-label="Permission required: Run fake side effect"');
    expect(body).toContain('aria-label="Decide permission for Run fake side effect"');
    expect(body).toContain('Allow once');
    expect(body).toContain('Allow for this run');
    expect(body).not.toContain('disabled=""');
  });

  it('renders compacted context and a direct proposal review affordance', () => {
    const body = renderMessage('assistant', {
      parts: [
        { id: 'text', type: 'text', text: 'Done' },
        {
          id: 'context', type: 'context', compacted: true,
          selectedNoteTitles: ['Project plan']
        },
        {
          id: 'proposal:proposal-1', type: 'proposalRef', proposalId: 'proposal-1',
          title: 'Project plan', kind: 'update'
        }
      ]
    });

    expect(body).toContain('Earlier conversation context was compacted.');
    expect(body).toContain('Project plan');
    expect(body).toContain('Note changes prepared');
    expect(body).toContain('Review');
  });

  it('shows concrete actions in runtime order without exposing model turns', () => {
    const body = renderMessage('assistant', {
      status: 'completed',
      parts: [
        { id: 'text', type: 'text', text: 'Done' },
        {
          id: 'tool:search', type: 'tool', callId: 'search', name: 'search_notes',
          title: 'Search notes for “budget”', status: 'success', stepIndex: 1
        },
        {
          id: 'tool:read', type: 'tool', callId: 'read', name: 'read_note',
          title: 'Read “Budget”', status: 'success', stepIndex: 0
        },
        {
          id: 'tool:edit', type: 'tool', callId: 'edit', name: 'propose_note_edits',
          title: 'Prepare changes to “Budget”', status: 'running', stepIndex: 2
        }
      ]
    });

    expect(body).not.toContain('Running');
    expect(body).not.toContain('Step 1');
    expect(body.indexOf('Read “Budget”')).toBeLessThan(
      body.indexOf('Search notes for “budget”')
    );
    expect(body.indexOf('Search notes for “budget”')).toBeLessThan(
      body.indexOf('Prepare changes to “Budget”')
    );
    expect(body).toContain('Activity, 3 of 3 actions complete');
  });
});
