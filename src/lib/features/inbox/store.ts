import { resolve } from '$app/paths';
import { goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';
import { get, writable } from 'svelte/store';
import {
  activeProposalSession,
  clearProposalSession,
  focusProposalPath,
  getApprovedChangesForSession,
  syncProposalSessionFromInboxItem
} from '$lib/features/proposals/session';
import type {
  ClearInboxResult,
  InboxItemDetail,
  InboxListItem,
  InboxMutationDelta
} from '$lib/types/ai';
import {
  applyInboxListSnapshot,
  initializeInboxListResource,
  refreshInboxList,
  subscribeInboxListResource,
  type InboxListResourceState
} from '$lib/features/inbox/listResource';

export type InboxGroupKey =
  | 'pendingApproval'
  | 'running'
  | 'applied'
  | 'failed'
  | 'stale'
  | 'rejected';

export const inboxGroupLabels: Record<InboxGroupKey, string> = {
  pendingApproval: 'Pending Approval',
  running: 'Running',
  applied: 'Applied',
  failed: 'Failed',
  stale: 'Stale',
  rejected: 'Rejected'
};

export interface InboxState {
  items: InboxListItem[];
  groupedItems: Record<InboxGroupKey, InboxListItem[]>;
  selectedId: number | null;
  selectedItem: InboxItemDetail | null;
  isLoading: boolean;
  isMutating: boolean;
  errorMessage: string;
  hasClearableItems: boolean;
}

function createGroupedItems(items: InboxListItem[]): Record<InboxGroupKey, InboxListItem[]> {
  const grouped: Record<InboxGroupKey, InboxListItem[]> = {
    pendingApproval: [],
    running: [],
    applied: [],
    failed: [],
    stale: [],
    rejected: []
  };

  for (const item of items) {
    grouped[groupForStatus(item.status)].push(item);
  }

  return grouped;
}

function createInitialState(): InboxState {
  const items: InboxListItem[] = [];
  return {
    items,
    groupedItems: createGroupedItems(items),
    selectedId: null,
    selectedItem: null,
    isLoading: false,
    isMutating: false,
    errorMessage: '',
    hasClearableItems: false
  };
}

export function groupForStatus(status: InboxListItem['status']): InboxGroupKey {
  if (status === 'pendingApproval') return 'pendingApproval';
  if (status === 'queued' || status === 'running') return 'running';
  if (status === 'applied') return 'applied';
  if (status === 'rejected') return 'rejected';
  if (status === 'failed') return 'failed';
  if (status === 'stale') return 'stale';
  return 'failed';
}

export function formatInboxTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

export function formatInboxStatusLabel(status: InboxListItem['status']) {
  if (status === 'pendingApproval') return 'Pending approval';
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Running';
  if (status === 'applied') return 'Applied';
  if (status === 'rejected') return 'Rejected';
  if (status === 'failed') return 'Failed';
  if (status === 'stale') return 'Stale';
  return status;
}

export function inboxStatusBadgeClass(status: InboxListItem['status']) {
  if (status === 'pendingApproval') return 'border-amber-400/35 bg-amber-500/15 text-amber-200';
  if (status === 'queued' || status === 'running') return 'border-sky-400/35 bg-sky-500/15 text-sky-200';
  if (status === 'applied') return 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200';
  if (status === 'failed' || status === 'rejected') return 'border-rose-400/35 bg-rose-500/15 text-rose-200';
  if (status === 'stale') return 'border-zinc-400/35 bg-zinc-500/15 text-zinc-200';
  return 'border-border/70 bg-muted/60 text-muted-foreground';
}

function syncDerivedState(
  state: InboxState,
  partial: Partial<Omit<InboxState, 'groupedItems' | 'hasClearableItems'>>
): InboxState {
  const nextState = { ...state, ...partial };
  return {
    ...nextState,
    groupedItems: createGroupedItems(nextState.items),
    hasClearableItems: nextState.items.some((item) => item.status !== 'pendingApproval')
  };
}

export function createInboxStore() {
  const store = writable<InboxState>(createInitialState());
  const { subscribe, update } = store;

  let activeDetailRequest = 0;
  let inboxListResourceUnsubscribe: (() => void) | null = null;
  let inboxListResourceDispose: (() => void) | null = null;
  let selectedListItemVersion: string | null = null;
  let latestListFingerprint = '';

  function patch(partial: Partial<Omit<InboxState, 'groupedItems' | 'hasClearableItems'>>) {
    update((state) => syncDerivedState(state, partial));
  }

  function listItemVersion(item: InboxListItem) {
    return `${item.id}:${item.status}:${item.updatedAtMillis}`;
  }

  function listFingerprint(items: InboxListItem[]) {
    return items.map((item) => listItemVersion(item)).join('|');
  }

  function setSelectedItem(
    item: InboxItemDetail | null,
    { preserveSelections = true }: { preserveSelections?: boolean } = {}
  ) {
    if (item === null) {
      selectedListItemVersion = null;
    } else {
      const selectedListItem = get(store).items.find((entry) => entry.id === item.id);
      selectedListItemVersion = selectedListItem ? listItemVersion(selectedListItem) : null;
    }

    update((state) =>
      syncDerivedState(state, {
        selectedId: item?.id ?? null,
        selectedItem: item
      })
    );
    syncProposalSessionFromInboxItem(item, { preserveSelections });
  }

  async function selectInboxItem(id: number, { preserveSelections = true } = {}) {
    const requestId = ++activeDetailRequest;
    patch({ selectedId: id, errorMessage: '' });

    try {
      const item = await invoke<InboxItemDetail | null>('get_inbox_item', { id });
      if (requestId !== activeDetailRequest) {
        return;
      }
      setSelectedItem(item, { preserveSelections });
    } catch (error) {
      if (requestId !== activeDetailRequest) {
        return;
      }
      console.error('Failed to load inbox item:', error);
      patch({ errorMessage: 'Unable to load the selected Inbox item.' });
    }
  }

  async function syncSelectedInboxItem(nextItems: InboxListItem[]) {
    const currentSelectedId = get(store).selectedId;
    if (currentSelectedId !== null) {
      const selectedListItem = nextItems.find((item) => item.id === currentSelectedId);
      if (selectedListItem) {
        const nextVersion = listItemVersion(selectedListItem);
        if (nextVersion !== selectedListItemVersion) {
          await selectInboxItem(currentSelectedId);
        }
        return;
      }
    }

    const nextSelectedId = nextItems[0]?.id ?? null;
    if (nextSelectedId === null) {
      activeDetailRequest += 1;
      selectedListItemVersion = null;
      patch({ selectedId: null, selectedItem: null });
      clearProposalSession();
      return;
    }

    await selectInboxItem(nextSelectedId, { preserveSelections: false });
  }

  function handleInboxListResourceUpdate(resourceState: InboxListResourceState) {
    const nextFingerprint = listFingerprint(resourceState.items);
    const listChanged = nextFingerprint !== latestListFingerprint;
    latestListFingerprint = nextFingerprint;

    patch({
      items: resourceState.items,
      isLoading: resourceState.isLoading,
      errorMessage: resourceState.errorMessage
    });

    if (resourceState.errorMessage || !listChanged) {
      return;
    }

    void syncSelectedInboxItem(resourceState.items);
  }

  async function loadInbox({ background = false } = {}) {
    await refreshInboxList({ background });
  }

  function applyInboxMutationDelta(delta: InboxMutationDelta) {
    applyInboxListSnapshot(delta.items);
    if (delta.item) {
      setSelectedItem(delta.item, { preserveSelections: false });
    } else {
      // The mutation removed the selected item from the inbox; pick the
      // next available item (or clear) using the canonical list we just
      // applied.
      const fallback = delta.items[0]?.id ?? null;
      if (fallback === null) {
        activeDetailRequest += 1;
        selectedListItemVersion = null;
        patch({ selectedId: null, selectedItem: null });
        clearProposalSession();
      } else {
        void selectInboxItem(fallback, { preserveSelections: false });
      }
    }
    latestListFingerprint = listFingerprint(delta.items);
  }

  async function runInboxAction(
    command: 'approve_inbox_item' | 'reject_inbox_item' | 'retry_inbox_item'
  ) {
    const selectedId = get(store).selectedId;
    if (selectedId === null) {
      return;
    }

    patch({ isMutating: true });
    try {
      const delta = await invoke<InboxMutationDelta>(command, { id: selectedId });
      applyInboxMutationDelta(delta);
      patch({ errorMessage: '' });
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
      patch({ errorMessage: 'Unable to update the Inbox item.' });
    } finally {
      patch({ isMutating: false });
    }
  }

  async function clearInbox() {
    patch({ isMutating: true });
    try {
      const result = await invoke<ClearInboxResult>('clear_inbox');
      applyInboxListSnapshot(result.items);
      latestListFingerprint = listFingerprint(result.items);
      // Selection may now point at an item that no longer exists; sync.
      await syncSelectedInboxItem(result.items);
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to clear inbox:', error);
      patch({ errorMessage: 'Unable to clear Inbox items.' });
    } finally {
      patch({ isMutating: false });
    }
  }

  async function approveSelectedChanges() {
    const selectedId = get(store).selectedId;
    if (selectedId === null) {
      return;
    }

    patch({ isMutating: true });
    try {
      const changes = getApprovedChangesForSession(get(activeProposalSession));
      const delta =
        changes.length === 0
          ? await invoke<InboxMutationDelta>('reject_inbox_item', { id: selectedId })
          : await invoke<InboxMutationDelta>('approve_inbox_item_with_changes', {
              id: selectedId,
              changes
            });
      clearProposalSession();
      applyInboxMutationDelta(delta);
    } catch (error) {
      console.error('Failed to approve edited changes:', error);
      patch({ errorMessage: 'Unable to approve the selected changes.' });
    } finally {
      patch({ isMutating: false });
    }
  }

  async function openProposalPathInNotepad(path: string) {
    const selectedItem = get(store).selectedItem;
    if (!selectedItem || selectedItem.status !== 'pendingApproval') {
      return;
    }

    patch({ isMutating: true });
    try {
      focusProposalPath(path);
      await invoke('open_note', { path });
      await goto(resolve('/'));
    } catch (error) {
      console.error('Failed to open proposal note in notepad:', error);
      patch({ errorMessage: 'Unable to open the proposed note in Notepad.' });
    } finally {
      patch({ isMutating: false });
    }
  }

  function initialize() {
    if (inboxListResourceDispose || inboxListResourceUnsubscribe) {
      return;
    }

    inboxListResourceDispose = initializeInboxListResource();
    inboxListResourceUnsubscribe = subscribeInboxListResource(handleInboxListResourceUpdate);
  }

  function dispose() {
    activeDetailRequest += 1;
    selectedListItemVersion = null;
    latestListFingerprint = '';
    inboxListResourceUnsubscribe?.();
    inboxListResourceUnsubscribe = null;
    inboxListResourceDispose?.();
    inboxListResourceDispose = null;
  }

  return {
    subscribe,
    selectInboxItem,
    loadInbox,
    runInboxAction,
    clearInbox,
    approveSelectedChanges,
    openProposalPathInNotepad,
    initialize,
    dispose
  };
}
