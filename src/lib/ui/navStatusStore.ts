import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { writable } from 'svelte/store';
import type { InboxListItem } from '$lib/types/ai';

export type InboxStatusIndicator = 'running' | 'pendingApproval' | null;

export interface NavStatusState {
  inboxStatusIndicator: InboxStatusIndicator;
}

function createInitialState(): NavStatusState {
  return {
    inboxStatusIndicator: null
  };
}

function nextInboxStatusIndicator(items: InboxListItem[]): InboxStatusIndicator {
  if (items.some((item) => item.status === 'pendingApproval')) {
    return 'pendingApproval';
  }

  if (items.some((item) => item.status === 'queued' || item.status === 'running')) {
    return 'running';
  }

  return null;
}

export function createNavStatusStore() {
  const store = writable<NavStatusState>(createInitialState());
  const { subscribe, update } = store;
  let inboxUnlisten: UnlistenFn | null = null;
  let activeRequest = 0;

  function patch(partial: Partial<NavStatusState>) {
    update((state) => ({ ...state, ...partial }));
  }

  async function loadInboxStatusIndicator() {
    const requestId = ++activeRequest;

    try {
      const items = await invoke<InboxListItem[]>('list_inbox_items');
      if (requestId !== activeRequest) {
        return;
      }
      patch({ inboxStatusIndicator: nextInboxStatusIndicator(items) });
    } catch (error) {
      if (requestId !== activeRequest) {
        return;
      }
      console.error('Failed to load inbox status indicator:', error);
      patch({ inboxStatusIndicator: null });
    }
  }

  function initialize() {
    void loadInboxStatusIndicator();
    void listen('inbox-changed', () => {
      void loadInboxStatusIndicator();
    }).then((unlisten) => {
      inboxUnlisten = unlisten;
    });
  }

  function dispose() {
    activeRequest += 1;
    inboxUnlisten?.();
    inboxUnlisten = null;
  }

  return {
    subscribe,
    loadInboxStatusIndicator,
    initialize,
    dispose
  };
}
