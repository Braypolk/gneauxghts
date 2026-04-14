import { resolve } from '$app/paths';
import { goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get, writable } from 'svelte/store';
import {
  activeProposalSession,
  clearProposalSession,
  focusProposalPath,
  getApprovedChangesForSession,
  syncProposalSessionFromInboxItem
} from '$lib/features/proposals/session';
import type { ClearInboxResult, InboxItemDetail, InboxListItem } from '$lib/types/ai';

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
  return {
    pendingApproval: items.filter((item) => groupForStatus(item.status) === 'pendingApproval'),
    running: items.filter((item) => groupForStatus(item.status) === 'running'),
    applied: items.filter((item) => groupForStatus(item.status) === 'applied'),
    failed: items.filter((item) => groupForStatus(item.status) === 'failed'),
    stale: items.filter((item) => groupForStatus(item.status) === 'stale'),
    rejected: items.filter((item) => groupForStatus(item.status) === 'rejected')
  };
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
    hasClearableItems: nextState.items.some(
      (item) =>
        item.status === 'queued' ||
        item.status === 'running' ||
        item.status === 'applied' ||
        item.status === 'failed' ||
        item.status === 'stale' ||
        item.status === 'rejected'
    )
  };
}

export function createInboxStore() {
  const store = writable<InboxState>(createInitialState());
  const { subscribe, update } = store;

  let inboxUnlisten: UnlistenFn | null = null;
  let activeListRequest = 0;
  let activeDetailRequest = 0;

  function patch(partial: Partial<Omit<InboxState, 'groupedItems' | 'hasClearableItems'>>) {
    update((state) => syncDerivedState(state, partial));
  }

  function setSelectedItem(
    item: InboxItemDetail | null,
    { preserveSelections = true }: { preserveSelections?: boolean } = {}
  ) {
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

  async function loadInbox({ background = false } = {}) {
    const requestId = ++activeListRequest;

    if (!background) {
      patch({ isLoading: true });
    }

    try {
      const nextItems = await invoke<InboxListItem[]>('list_inbox_items');
      if (requestId !== activeListRequest) {
        return;
      }

      patch({
        items: nextItems,
        errorMessage: ''
      });

      const currentSelectedId = get(store).selectedId;
      if (currentSelectedId !== null && nextItems.some((item) => item.id === currentSelectedId)) {
        await selectInboxItem(currentSelectedId);
        return;
      }

      const nextSelectedId = nextItems[0]?.id ?? null;
      if (nextSelectedId === null) {
        activeDetailRequest += 1;
        patch({ selectedId: null, selectedItem: null });
        clearProposalSession();
        return;
      }

      await selectInboxItem(nextSelectedId, { preserveSelections: false });
    } catch (error) {
      if (requestId !== activeListRequest) {
        return;
      }
      console.error('Failed to load inbox:', error);
      patch({ errorMessage: 'Unable to load Inbox items.' });
    } finally {
      if (requestId === activeListRequest) {
        patch({ isLoading: false });
      }
    }
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
      await invoke<InboxItemDetail | null>(command, { id: selectedId });
      await loadInbox({ background: false });
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
      await invoke<ClearInboxResult>('clear_inbox');
      await loadInbox({ background: false });
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
      if (changes.length === 0) {
        await invoke<InboxItemDetail | null>('reject_inbox_item', { id: selectedId });
      } else {
        await invoke<InboxItemDetail | null>('approve_inbox_item_with_changes', {
          id: selectedId,
          changes
        });
      }
      clearProposalSession();
      await loadInbox({ background: false });
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
    void loadInbox();
    void listen('inbox-changed', () => {
      void loadInbox({ background: get(store).items.length > 0 });
    }).then((unlisten) => {
      inboxUnlisten = unlisten;
    });
  }

  function dispose() {
    activeListRequest += 1;
    activeDetailRequest += 1;
    inboxUnlisten?.();
    inboxUnlisten = null;
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
