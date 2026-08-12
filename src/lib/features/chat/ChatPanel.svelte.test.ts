import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ChatPanel from './ChatPanel.svelte';
import type {
  ChatController,
  ChatControllerState
} from './controller.svelte';

function controllerWithSnapshot(
  snapshot: ChatControllerState
): ChatController {
  return {
    getSnapshot: () => snapshot,
    subscribe: (run) => {
      run(snapshot);
      return () => undefined;
    }
  } as ChatController;
}

describe('ChatPanel initial render', () => {
  it('uses the controller vault state without an approved-only emphasis frame', () => {
    const snapshot: ChatControllerState = {
      settings: null,
      conversations: [],
      conversationDraft: {
        revision: 1,
        title: '',
        provider: 'openai',
        model: 'configured-model',
        vaultAccess: 'full'
      },
      grants: [],
      policies: [],
      conversation: null,
      isInitialized: true,
      isInitializing: false,
      isLoadingConversation: false,
      isSending: false,
      error: null,
      activity: null,
      proposals: [],
      modelCapabilities: null
    };

    const body = render(ChatPanel, {
      props: {
        controller: controllerWithSnapshot(snapshot),
        autoInitialize: false,
        contextNote: {
          noteId: 'note-1',
          notePath: '/vault/Note.md',
          noteTitle: 'Note'
        }
      }
    }).body;

    expect(body).toContain('Full vault');
    expect(body).toContain('min-w-0 w-full max-w-full');
    expect(body).not.toContain('chat-composer-chip--emphasis');
  });

  it('withholds configuration controls before initialization completes', () => {
    const snapshot: ChatControllerState = {
      settings: null,
      conversations: [],
      conversationDraft: {
        revision: 0,
        title: '',
        provider: 'openai',
        model: '',
        vaultAccess: 'approved'
      },
      grants: [],
      policies: [],
      conversation: null,
      isInitialized: false,
      isInitializing: false,
      isLoadingConversation: false,
      isSending: false,
      error: null,
      activity: null,
      proposals: [],
      modelCapabilities: null
    };

    const body = render(ChatPanel, {
      props: {
        controller: controllerWithSnapshot(snapshot),
        autoInitialize: false,
        contextNote: {
          noteId: 'note-1',
          notePath: '/vault/Note.md',
          noteTitle: 'Note'
        }
      }
    }).body;

    expect(body).not.toContain('aria-label="Vault access"');
    expect(body).not.toContain('Allow note');
    expect(body).not.toContain('chat-composer-chip--emphasis');
  });
});
