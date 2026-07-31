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
    expect(body).not.toContain('chat-composer-chip--emphasis');
  });
});
