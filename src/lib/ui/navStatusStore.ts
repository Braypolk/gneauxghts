import { writable } from 'svelte/store';
import type { InboxListItem } from '$lib/types/ai';
import {
  initializeInboxListResource,
  subscribeInboxListResource
} from '$lib/features/inbox/listResource';

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
  let inboxListResourceUnsubscribe: (() => void) | null = null;
  let inboxListResourceDispose: (() => void) | null = null;

  function patch(partial: Partial<NavStatusState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function initialize() {
    if (inboxListResourceDispose || inboxListResourceUnsubscribe) {
      return;
    }

    inboxListResourceDispose = initializeInboxListResource();
    inboxListResourceUnsubscribe = subscribeInboxListResource((resourceState) => {
      patch({ inboxStatusIndicator: nextInboxStatusIndicator(resourceState.items) });
    });
  }

  function dispose() {
    inboxListResourceUnsubscribe?.();
    inboxListResourceUnsubscribe = null;
    inboxListResourceDispose?.();
    inboxListResourceDispose = null;
  }

  return {
    subscribe,
    initialize,
    dispose
  };
}
