import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get, writable } from 'svelte/store';
import type { InboxListItem } from '$lib/types/ai';

export interface InboxListResourceState {
  items: InboxListItem[];
  isLoading: boolean;
  errorMessage: string;
}

const inboxListResource = writable<InboxListResourceState>({
  items: [],
  isLoading: false,
  errorMessage: ''
});

let inboxUnlisten: UnlistenFn | null = null;
let activeRequest = 0;
let activeForegroundRequests = 0;
let consumerCount = 0;
let startPromise: Promise<void> | null = null;

function patchInboxListResource(partial: Partial<InboxListResourceState>) {
  inboxListResource.update((state) => ({ ...state, ...partial }));
}

function currentInboxItems() {
  return get(inboxListResource).items;
}

/**
 * Apply a canonical inbox list returned by a mutation command directly to
 * the resource. Bumps the request id so any in-flight refresh response is
 * discarded — the snapshot is the authoritative state.
 */
export function applyInboxListSnapshot(items: InboxListItem[]): void {
  activeRequest += 1;
  patchInboxListResource({ items, errorMessage: '' });
}

export async function refreshInboxList({ background = false } = {}): Promise<InboxListItem[]> {
  const requestId = ++activeRequest;

  if (!background) {
    activeForegroundRequests += 1;
    patchInboxListResource({ isLoading: true, errorMessage: '' });
  }

  try {
    const nextItems = await invoke<InboxListItem[]>('list_inbox_items');
    if (requestId !== activeRequest) {
      return currentInboxItems();
    }

    patchInboxListResource({
      items: nextItems,
      errorMessage: ''
    });

    return nextItems;
  } catch (error) {
    if (requestId !== activeRequest) {
      return currentInboxItems();
    }

    console.error('Failed to load inbox list resource:', error);
    patchInboxListResource({ errorMessage: 'Unable to load Inbox items.' });
    return currentInboxItems();
  } finally {
    if (!background) {
      activeForegroundRequests = Math.max(0, activeForegroundRequests - 1);
      patchInboxListResource({ isLoading: activeForegroundRequests > 0 });
    }
  }
}

async function startInboxListSync() {
  if (inboxUnlisten || startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    await refreshInboxList();
    inboxUnlisten = await listen('inbox-changed', () => {
      void refreshInboxList({ background: get(inboxListResource).items.length > 0 });
    });
  })().finally(() => {
    startPromise = null;
  });

  return startPromise;
}

function stopInboxListSync() {
  activeRequest += 1;
  activeForegroundRequests = 0;
  patchInboxListResource({ isLoading: false });
  inboxUnlisten?.();
  inboxUnlisten = null;
}

export function subscribeInboxListResource(run: (state: InboxListResourceState) => void) {
  return inboxListResource.subscribe(run);
}

export function initializeInboxListResource() {
  consumerCount += 1;
  if (consumerCount === 1) {
    void startInboxListSync();
  }

  return () => {
    consumerCount = Math.max(0, consumerCount - 1);
    if (consumerCount === 0) {
      stopInboxListSync();
    }
  };
}
