<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { onDestroy, onMount } from 'svelte';
  import {
    buildReviewChanges,
  } from '$lib/features/inbox/reviewDiff';
  import ProposalReviewList from '$lib/features/proposals/ProposalReviewList.svelte';
  import {
    activeProposalSession,
    clearProposalSession,
    focusProposalPath,
    getApprovedChangesForSession,
    getSelectedApprovedChangeCount,
    syncProposalSessionFromInboxItem,
    toggleProposalChange,
    toggleProposalHunk,
    toggleProposalTitle
  } from '$lib/features/proposals/session';
  import type { ClearInboxResult, InboxItemDetail, InboxListItem } from '$lib/types/ai';

  type InboxGroupKey = 'pendingApproval' | 'running' | 'applied' | 'failed' | 'stale' | 'rejected';

  const groupLabels: Record<InboxGroupKey, string> = {
    pendingApproval: 'Pending Approval',
    running: 'Running',
    applied: 'Applied',
    failed: 'Failed',
    stale: 'Stale',
    rejected: 'Rejected'
  };

  let items = $state<InboxListItem[]>([]);
  let selectedId = $state<number | null>(null);
  let selectedItem = $state<InboxItemDetail | null>(null);
  let isLoading = $state(false);
  let isMutating = $state(false);
  let errorMessage = $state('');
  let inboxUnlisten: UnlistenFn | null = null;
  let reviewChanges = $derived.by(() => {
    if (!selectedItem) {
      return [];
    }

    if (
      selectedItem.status === 'pendingApproval' &&
      $activeProposalSession?.itemId === selectedItem.id
    ) {
      return $activeProposalSession.reviewChanges;
    }

    return buildReviewChanges(selectedItem.changePreviews);
  });

  function groupForStatus(status: InboxListItem['status']): InboxGroupKey {
    if (status === 'pendingApproval') return 'pendingApproval';
    if (status === 'queued' || status === 'running') return 'running';
    if (status === 'applied') return 'applied';
    if (status === 'rejected') return 'rejected';
    if (status === 'failed') return 'failed';
    if (status === 'stale') return 'stale';
    return 'failed';
  }

  function groupedItems(key: InboxGroupKey) {
    return items.filter((item) => groupForStatus(item.status) === key);
  }

  function hasClearableItems() {
    return items.some(
      (item) =>
        item.status === 'queued' ||
        item.status === 'running' ||
        item.status === 'applied' ||
        item.status === 'failed' ||
        item.status === 'stale' ||
        item.status === 'rejected'
    );
  }

  function formatTimestamp(value: number) {
    return new Date(value).toLocaleString();
  }

  function formatStatusLabel(status: InboxListItem['status']) {
    if (status === 'pendingApproval') return 'Pending approval';
    if (status === 'queued') return 'Queued';
    if (status === 'running') return 'Running';
    if (status === 'applied') return 'Applied';
    if (status === 'rejected') return 'Rejected';
    if (status === 'failed') return 'Failed';
    if (status === 'stale') return 'Stale';
    return status;
  }

  function statusBadgeClass(status: InboxListItem['status']) {
    if (status === 'pendingApproval') return 'border-amber-400/35 bg-amber-500/15 text-amber-200';
    if (status === 'queued' || status === 'running') return 'border-sky-400/35 bg-sky-500/15 text-sky-200';
    if (status === 'applied') return 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200';
    if (status === 'failed' || status === 'rejected') return 'border-rose-400/35 bg-rose-500/15 text-rose-200';
    if (status === 'stale') return 'border-zinc-400/35 bg-zinc-500/15 text-zinc-200';
    return 'border-border/70 bg-muted/60 text-muted-foreground';
  }

  function setSelectedInboxItem(item: InboxItemDetail | null) {
    selectedItem = item;
    syncProposalSessionFromInboxItem(item);
  }

  async function loadInbox() {
    isLoading = true;
    try {
      const nextItems = await invoke<InboxListItem[]>('list_inbox_items');
      items = nextItems;
      errorMessage = '';
      if (selectedId !== null && nextItems.some((item) => item.id === selectedId)) {
        await loadInboxItem(selectedId);
        return;
      }
      const nextSelectedId = nextItems[0]?.id ?? null;
      selectedId = nextSelectedId;
      setSelectedInboxItem(
        nextSelectedId === null
          ? null
          : await invoke<InboxItemDetail | null>('get_inbox_item', { id: nextSelectedId })
      );
    } catch (error) {
      console.error('Failed to load inbox:', error);
      errorMessage = 'Unable to load Inbox items.';
    } finally {
      isLoading = false;
    }
  }

  async function loadInboxItem(id: number) {
    try {
      selectedId = id;
      setSelectedInboxItem(await invoke<InboxItemDetail | null>('get_inbox_item', { id }));
    } catch (error) {
      console.error('Failed to load inbox item:', error);
      errorMessage = 'Unable to load the selected Inbox item.';
    }
  }

  async function runAction(command: 'approve_inbox_item' | 'reject_inbox_item' | 'retry_inbox_item') {
    if (selectedId === null) {
      return;
    }
    isMutating = true;
    try {
      setSelectedInboxItem(await invoke<InboxItemDetail | null>(command, { id: selectedId }));
      await loadInbox();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
      errorMessage = 'Unable to update the Inbox item.';
    } finally {
      isMutating = false;
    }
  }

  async function clearInbox() {
    isMutating = true;
    try {
      await invoke<ClearInboxResult>('clear_inbox');
      await loadInbox();
      errorMessage = '';
    } catch (error) {
      console.error('Failed to clear inbox:', error);
      errorMessage = 'Unable to clear Inbox items.';
    } finally {
      isMutating = false;
    }
  }

  async function approveSelectedChanges() {
    if (selectedId === null) {
      return;
    }
    isMutating = true;
    try {
      const changes = getApprovedChangesForSession($activeProposalSession);
      if (changes.length === 0) {
        setSelectedInboxItem(await invoke<InboxItemDetail | null>('reject_inbox_item', { id: selectedId }));
      } else {
        setSelectedInboxItem(
          await invoke<InboxItemDetail | null>('approve_inbox_item_with_changes', {
            id: selectedId,
            changes
          })
        );
      }
      clearProposalSession();
      await loadInbox();
    } catch (error) {
      console.error('Failed to approve edited changes:', error);
      errorMessage = 'Unable to approve the selected changes.';
    } finally {
      isMutating = false;
    }
  }

  function selectedApprovedChangeCount() {
    return getSelectedApprovedChangeCount($activeProposalSession);
  }

  async function openProposalPathInNotepad(path: string) {
    if (!selectedItem || selectedItem.status !== 'pendingApproval') {
      return;
    }

    isMutating = true;
    try {
      focusProposalPath(path);
      await invoke('open_note', { path });
      await goto(resolve('/'));
    } catch (error) {
      console.error('Failed to open proposal note in notepad:', error);
      errorMessage = 'Unable to open the proposed note in Notepad.';
    } finally {
      isMutating = false;
    }
  }

  onMount(() => {
    void loadInbox();
    void listen('inbox-changed', () => {
      void loadInbox();
    }).then((unlisten) => {
      inboxUnlisten = unlisten;
    });
  });

  onDestroy(() => {
    inboxUnlisten?.();
    inboxUnlisten = null;
  });
</script>

<div class="h-full w-full overflow-hidden bg-background text-foreground">
  <main class="mx-auto flex h-full w-full max-w-7xl flex-col px-0 pb-6 sm:px-4 sm:pb-8 lg:px-6">
    <section class="mt-0 flex h-full min-h-0 w-full overflow-hidden border-y border-border/70 bg-gradient-to-b from-card/95 to-card/80 shadow-xl shadow-black/5 backdrop-blur-xl sm:mt-2 sm:rounded-[1.75rem] sm:border">
      <aside class="flex w-full max-w-[23.5rem] shrink-0 flex-col border-r border-border/60 bg-card/55">
        <div class="border-b border-border/60 px-4 py-4 sm:px-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/90">Inbox</p>
              <p class="mt-1 text-sm font-medium text-foreground">AI jobs and approvals</p>
              <p class="mt-1 text-xs text-muted-foreground">Review statuses, changes, and failures.</p>
            </div>
            <button
              class="rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={isMutating || !hasClearableItems()}
              onclick={() => void clearInbox()}
            >
              Clear
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {#if isLoading && items.length === 0}
            <div class="mx-2 rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center">
              <p class="text-sm font-medium text-foreground">Loading inbox...</p>
              <p class="mt-1 text-xs text-muted-foreground">Fetching recent AI activity.</p>
            </div>
          {:else if items.length === 0}
            <div class="mx-2 rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center">
              <p class="text-sm font-medium text-foreground">No inbox items yet</p>
              <p class="mt-1 text-xs text-muted-foreground">Run an AI flow and it will appear here.</p>
            </div>
          {:else}
            <div class="space-y-6">
              {#each (Object.keys(groupLabels) as InboxGroupKey[]) as groupKey (groupKey)}
                {@const groupItems = groupedItems(groupKey)}
                {#if groupItems.length > 0}
                  <section>
                    <div class="mb-2 flex items-center justify-between px-3">
                      <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        {groupLabels[groupKey]}
                      </p>
                      <span class="rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {groupItems.length}
                      </span>
                    </div>
                    <div class="space-y-2.5">
                      {#each groupItems as item (item.id)}
                        <button
                          type="button"
                          class={`group w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                            selectedId === item.id
                              ? 'border-primary/40 bg-primary/10 shadow-md shadow-primary/10 ring-1 ring-primary/20'
                              : 'border-border/70 bg-background/70 hover:border-border hover:bg-accent/80'
                          }`}
                          onclick={() => void loadInboxItem(item.id)}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <p class="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{item.title}</p>
                            <span class="shrink-0 rounded-full border border-border/60 bg-background/90 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                              {item.actionLabel}
                            </span>
                          </div>
                          {#if item.affectedNotes.length > 0}
                            <p class="mt-2 line-clamp-2 text-xs text-muted-foreground">
                              {item.affectedNotes.join(' · ')}
                            </p>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  </section>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      </aside>

      <section class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-8">
        {#if errorMessage}
          <div class="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-destructive">Error</p>
            <p class="mt-1 text-sm text-destructive">{errorMessage}</p>
          </div>
        {/if}

        {#if !selectedItem}
          <div class="flex h-full items-center justify-center py-8">
            <div class="max-w-md rounded-3xl border border-dashed border-border/70 bg-background/60 px-8 py-10 text-center">
              <p class="text-base font-semibold text-foreground">Select an inbox item</p>
              <p class="mt-2 text-sm text-muted-foreground">
                Choose a job from the left to inspect details and proposed changes.
              </p>
            </div>
          </div>
        {:else}
          <div class="space-y-6">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {selectedItem.actionLabel}
                  </span>
                  <span class={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusBadgeClass(selectedItem.status)}`}>
                    {formatStatusLabel(selectedItem.status)}
                  </span>
                </div>
                <h1 class="mt-3 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{selectedItem.title}</h1>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                {#if selectedItem.status === 'pendingApproval'}
                  <button
                    class="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={isMutating}
                    onclick={() => void approveSelectedChanges()}
                  >
                    {selectedApprovedChangeCount() === 0 ? 'Reject All' : 'Approve Selected'}
                  </button>
                  <button
                    class="rounded-full border border-rose-400/35 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={isMutating}
                    onclick={() => void runAction('reject_inbox_item')}
                  >
                    Reject
                  </button>
                {/if}

                {#if selectedItem.status === 'failed' || selectedItem.status === 'stale' || selectedItem.status === 'rejected'}
                  <button
                    class="rounded-full border border-sky-400/35 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={isMutating}
                    onclick={() => void runAction('retry_inbox_item')}
                  >
                    Retry
                  </button>
                {/if}
              </div>
            </div>

            <div class="grid gap-4 xl:grid-cols-3">
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Source note</p>
                <p class="mt-2 text-sm font-semibold break-all text-foreground">{selectedItem.sourceTitle}</p>
                <p class="mt-1 text-xs text-muted-foreground break-all">{selectedItem.sourcePath}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Provider</p>
                <p class="mt-2 text-sm font-semibold text-foreground">{selectedItem.providerKind ?? 'pending'}</p>
                <p class="mt-1 text-xs text-muted-foreground">{selectedItem.model ?? 'Model pending'}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Timestamps</p>
                <p class="mt-2 text-sm font-semibold text-foreground">{formatTimestamp(selectedItem.createdAtMillis)}</p>
                <p class="mt-1 text-xs text-muted-foreground">Updated {formatTimestamp(selectedItem.updatedAtMillis)}</p>
              </div>
            </div>

            {#if selectedItem.failureReason}
              <div class="rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive">Failure reason</p>
                <p class="mt-2 text-sm leading-relaxed text-destructive">{selectedItem.failureReason}</p>
              </div>
            {/if}

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Source snapshot</p>
              <pre class="mt-3 max-h-[22rem] overflow-x-auto rounded-2xl border border-border/60 bg-background/80 p-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{selectedItem.sourceMarkdown}</pre>
            </div>

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Proposed changes</p>
              <div class="mt-4">
                <ProposalReviewList
                  {reviewChanges}
                  showOpenButtons={selectedItem.status === 'pendingApproval'}
                  onToggleChange={toggleProposalChange}
                  onToggleHunk={toggleProposalHunk}
                  onToggleTitle={toggleProposalTitle}
                  onOpenPath={(path) => void openProposalPathInNotepad(path)}
                />
              </div>
            </div>
          </div>
        {/if}
      </section>
    </section>
  </main>
</div>
