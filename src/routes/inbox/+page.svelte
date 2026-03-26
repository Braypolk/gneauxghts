<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { onDestroy, onMount } from 'svelte';
  import {
    buildApprovedChanges,
    buildReviewChanges,
    isReviewChangeSelected,
    setReviewChangeSelection,
    type DiffDisplayLine,
    type ReviewChange
  } from '$lib/features/inbox/reviewDiff';
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
  let reviewChanges = $state<ReviewChange[]>([]);
  let isLoading = $state(false);
  let isMutating = $state(false);
  let errorMessage = $state('');
  let inboxUnlisten: UnlistenFn | null = null;

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

  function setSelectedInboxItem(item: InboxItemDetail | null) {
    selectedItem = item;
    reviewChanges = item ? buildReviewChanges(item.changePreviews) : [];
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
      const changes = buildApprovedChanges(reviewChanges);
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
      await loadInbox();
    } catch (error) {
      console.error('Failed to approve edited changes:', error);
      errorMessage = 'Unable to approve the selected changes.';
    } finally {
      isMutating = false;
    }
  }

  function reviewChangeTitle(reviewChange: ReviewChange) {
    if (reviewChange.kind === 'updateNote') {
      return reviewChange.proposedTitle || reviewChange.currentTitle || 'Updated note';
    }
    if (reviewChange.kind === 'createNote') {
      return reviewChange.change.suggestedTitle || 'New note';
    }
    return reviewChange.title || 'Deleted note';
  }

  function acceptedHunkCount(reviewChange: ReviewChange) {
    if (reviewChange.kind !== 'updateNote') {
      return isReviewChangeSelected(reviewChange) ? 1 : 0;
    }
    return reviewChange.hunks.filter((hunk) => hunk.selected).length;
  }

  function toggleReviewChange(index: number, selected: boolean) {
    const nextChanges = [...reviewChanges];
    setReviewChangeSelection(nextChanges[index], selected);
    reviewChanges = nextChanges;
  }

  function toggleReviewHunk(changeIndex: number, hunkIndex: number, selected: boolean) {
    const nextChanges = [...reviewChanges];
    const reviewChange = nextChanges[changeIndex];
    if (reviewChange.kind !== 'updateNote') {
      reviewChanges = nextChanges;
      return;
    }
    reviewChange.hunks[hunkIndex].selected = selected;
    reviewChanges = nextChanges;
  }

  function toggleReviewTitle(changeIndex: number, selected: boolean) {
    const nextChanges = [...reviewChanges];
    const reviewChange = nextChanges[changeIndex];
    if (reviewChange.kind !== 'updateNote' || !reviewChange.titleChanged) {
      reviewChanges = nextChanges;
      return;
    }
    reviewChange.titleSelected = selected;
    reviewChanges = nextChanges;
  }

  function selectedApprovedChangeCount() {
    return buildApprovedChanges(reviewChanges).length;
  }

  function diffLinePrefix(line: DiffDisplayLine) {
    if (line.kind === 'add') return '+';
    if (line.kind === 'remove') return '-';
    return ' ';
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
  <main class="mx-auto flex h-full w-full max-w-6xl flex-col px-0 pb-6 sm:px-2 sm:pb-10">
    <section class="mt-0 flex h-full min-h-0 w-full overflow-hidden border-y border-border/80 bg-card/80 shadow-sm backdrop-blur-md sm:mt-2 sm:rounded-[1.75rem] sm:border">
      <aside class="flex w-full max-w-[22rem] shrink-0 flex-col border-r border-border/70">
        <div class="border-b border-border/70 px-4 py-4 sm:px-6">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Inbox</p>
              <p class="mt-1 text-sm text-muted-foreground">AI remember jobs, approvals, and failures.</p>
            </div>
            <button
              class="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              type="button"
              disabled={isMutating || !hasClearableItems()}
              onclick={() => void clearInbox()}
            >
              Clear
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {#if isLoading && items.length === 0}
            <p class="px-3 py-4 text-sm text-muted-foreground">Loading Inbox…</p>
          {:else if items.length === 0}
            <p class="px-3 py-4 text-sm text-muted-foreground">No AI jobs yet.</p>
          {:else}
            <div class="space-y-5">
              {#each (Object.keys(groupLabels) as InboxGroupKey[]) as groupKey}
                {@const groupItems = groupedItems(groupKey)}
                {#if groupItems.length > 0}
                  <section>
                    <p class="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {groupLabels[groupKey]}
                    </p>
                    <div class="space-y-2">
                      {#each groupItems as item}
                        <button
                          type="button"
                          class={`w-full rounded-[1.25rem] border px-4 py-3 text-left transition-colors ${
                            selectedId === item.id
                              ? 'border-foreground/15 bg-background shadow-sm'
                              : 'border-border/70 bg-background/70 hover:bg-accent'
                          }`}
                          onclick={() => void loadInboxItem(item.id)}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <p class="text-sm font-medium text-foreground">{item.title}</p>
                            <span class="shrink-0 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                              {item.kind}
                            </span>
                          </div>
                          <p class="mt-1 line-clamp-3 text-sm text-muted-foreground">{item.summary}</p>
                          {#if item.affectedNotes.length > 0}
                            <p class="mt-2 text-xs text-muted-foreground">
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

      <section class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {#if errorMessage}
          <div class="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        {/if}

        {#if !selectedItem}
          <div class="flex h-full items-center justify-center">
            <p class="text-sm text-muted-foreground">Select an Inbox item to inspect it.</p>
          </div>
        {:else}
          <div class="space-y-5">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  {selectedItem.kind} · {selectedItem.status}
                </p>
                <h1 class="mt-2 text-2xl font-semibold tracking-tight">{selectedItem.title}</h1>
                <p class="mt-2 max-w-3xl text-sm text-muted-foreground">{selectedItem.summary}</p>
              </div>

              <div class="flex items-center gap-2">
                {#if selectedItem.status === 'pendingApproval'}
                  <button
                    class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                    type="button"
                    disabled={isMutating}
                    onclick={() => void approveSelectedChanges()}
                  >
                    {selectedApprovedChangeCount() === 0 ? 'Reject All' : 'Approve Selected'}
                  </button>
                  <button
                    class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                    type="button"
                    disabled={isMutating}
                    onclick={() => void runAction('reject_inbox_item')}
                  >
                    Reject
                  </button>
                {/if}

                {#if selectedItem.status === 'failed' || selectedItem.status === 'stale' || selectedItem.status === 'rejected'}
                  <button
                    class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                    type="button"
                    disabled={isMutating}
                    onclick={() => void runAction('retry_inbox_item')}
                  >
                    Retry
                  </button>
                {/if}
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-3">
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Source note</p>
                <p class="mt-2 text-sm font-medium break-all">{selectedItem.sourceTitle}</p>
                <p class="mt-1 text-xs text-muted-foreground break-all">{selectedItem.sourcePath}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Provider</p>
                <p class="mt-2 text-sm font-medium">{selectedItem.providerKind ?? 'pending'}</p>
                <p class="mt-1 text-xs text-muted-foreground">{selectedItem.model ?? 'Model pending'}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Timestamps</p>
                <p class="mt-2 text-sm font-medium">{formatTimestamp(selectedItem.createdAtMillis)}</p>
                <p class="mt-1 text-xs text-muted-foreground">Updated {formatTimestamp(selectedItem.updatedAtMillis)}</p>
              </div>
            </div>

            {#if selectedItem.failureReason}
              <div class="rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-destructive">Failure</p>
                <p class="mt-2 text-sm text-destructive">{selectedItem.failureReason}</p>
              </div>
            {/if}

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Source snapshot</p>
              <pre class="mt-3 overflow-x-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground">{selectedItem.sourceMarkdown}</pre>
            </div>

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Proposed changes</p>
              {#if reviewChanges.length === 0}
                <p class="mt-3 text-sm text-muted-foreground">No note edits were proposed.</p>
              {:else}
                <div class="mt-4 space-y-4">
                  {#each reviewChanges as reviewChange, changeIndex (`${reviewChange.kind}-${reviewChangeTitle(reviewChange)}-${changeIndex}`)}
                    {@const noteSelected = isReviewChangeSelected(reviewChange)}
                    <div class={`rounded-2xl border px-4 py-4 transition-colors ${
                      noteSelected
                        ? 'border-border/70 bg-card/80'
                        : 'border-border/50 bg-card/45 opacity-75'
                    }`}>
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <p class="text-sm font-medium">{reviewChangeTitle(reviewChange)}</p>
                          <p class="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            {reviewChange.kind}
                          </p>
                          <p class="mt-1 text-xs text-muted-foreground">
                            {noteSelected ? 'Selected for approval' : 'Rejected from approval'}
                          </p>
                          {#if reviewChange.kind === 'updateNote'}
                            <p class="mt-1 text-xs text-muted-foreground">
                              {acceptedHunkCount(reviewChange)} of {reviewChange.hunks.length} hunks selected
                            </p>
                          {/if}
                        </div>
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              noteSelected
                                ? 'border-foreground/20 bg-foreground text-background'
                                : 'border-border bg-background hover:bg-accent'
                            }`}
                            onclick={() => toggleReviewChange(changeIndex, true)}
                          >
                            Accept note
                          </button>
                          <button
                            type="button"
                            class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              !noteSelected
                                ? 'border-foreground/20 bg-foreground text-background'
                                : 'border-border bg-background hover:bg-accent'
                            }`}
                            onclick={() => toggleReviewChange(changeIndex, false)}
                          >
                            Reject note
                          </button>
                        </div>
                      </div>

                      {#if reviewChange.kind === 'updateNote'}
                        {#if reviewChange.titleChanged}
                          <div class="mt-4 rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                            <div class="flex items-start justify-between gap-3">
                              <div>
                                <p class="text-xs uppercase tracking-[0.16em] text-muted-foreground">Title change</p>
                                <p class="mt-2 text-sm text-muted-foreground">
                                  {reviewChange.currentTitle}
                                  <span class="mx-2 text-muted-foreground/60">→</span>
                                  <span class="font-medium text-foreground">{reviewChange.proposedTitle}</span>
                                </p>
                              </div>
                              <div class="flex items-center gap-2">
                                <button
                                  type="button"
                                  class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    reviewChange.titleSelected
                                      ? 'border-foreground/20 bg-foreground text-background'
                                      : 'border-border bg-background hover:bg-accent'
                                  }`}
                                  onclick={() => toggleReviewTitle(changeIndex, true)}
                                >
                                  Accept title
                                </button>
                                <button
                                  type="button"
                                  class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    !reviewChange.titleSelected
                                      ? 'border-foreground/20 bg-foreground text-background'
                                      : 'border-border bg-background hover:bg-accent'
                                  }`}
                                  onclick={() => toggleReviewTitle(changeIndex, false)}
                                >
                                  Reject title
                                </button>
                              </div>
                            </div>
                          </div>
                        {/if}

                        {#if reviewChange.hunks.length === 0}
                          <p class="mt-4 text-sm text-muted-foreground">No line changes were proposed for this note.</p>
                        {:else}
                          <div class="mt-4 space-y-4">
                            {#each reviewChange.hunks as hunk, hunkIndex (hunk.id)}
                              <div class="rounded-2xl border border-border/70 bg-background/80">
                                <div class="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                                  <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                    Hunk {hunkIndex + 1}
                                  </p>
                                  <div class="flex items-center gap-2">
                                    <button
                                      type="button"
                                      class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                        hunk.selected
                                          ? 'border-foreground/20 bg-foreground text-background'
                                          : 'border-border bg-background hover:bg-accent'
                                      }`}
                                      onclick={() => toggleReviewHunk(changeIndex, hunkIndex, true)}
                                    >
                                      Accept hunk
                                    </button>
                                    <button
                                      type="button"
                                      class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                        !hunk.selected
                                          ? 'border-foreground/20 bg-foreground text-background'
                                          : 'border-border bg-background hover:bg-accent'
                                      }`}
                                      onclick={() => toggleReviewHunk(changeIndex, hunkIndex, false)}
                                    >
                                      Reject hunk
                                    </button>
                                  </div>
                                </div>

                                <div class="overflow-x-auto">
                                  <div class="min-w-[36rem] font-mono text-[12px] leading-6">
                                    {#each hunk.lines as line, lineIndex (`${hunk.id}-${lineIndex}`)}
                                      <div
                                        class={`grid grid-cols-[3.5rem_3.5rem_1.5rem_1fr] gap-0 border-b border-border/40 px-3 ${
                                          line.kind === 'add'
                                            ? hunk.selected
                                              ? 'bg-emerald-500/12'
                                              : 'bg-emerald-500/6 opacity-60'
                                            : line.kind === 'remove'
                                              ? hunk.selected
                                                ? 'bg-rose-500/12'
                                                : 'bg-rose-500/6 opacity-60'
                                              : 'bg-transparent'
                                        }`}
                                      >
                                        <span class="select-none px-2 text-right text-muted-foreground/75">
                                          {line.oldLineNumber ?? ''}
                                        </span>
                                        <span class="select-none px-2 text-right text-muted-foreground/75">
                                          {line.newLineNumber ?? ''}
                                        </span>
                                        <span class={`select-none px-2 ${
                                          line.kind === 'add'
                                            ? 'text-emerald-500'
                                            : line.kind === 'remove'
                                              ? 'text-rose-500'
                                              : 'text-muted-foreground/70'
                                        }`}>
                                          {diffLinePrefix(line)}
                                        </span>
                                        <span class="whitespace-pre-wrap break-words px-2 text-foreground">
                                          {line.text === '' ? ' ' : line.text}
                                        </span>
                                      </div>
                                    {/each}
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {:else if reviewChange.kind === 'createNote'}
                        <div class="mt-4 rounded-2xl border border-border/70 bg-background/80">
                          <div class="border-b border-border/70 px-4 py-3">
                            <p class="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              New note
                            </p>
                          </div>
                          <pre class="overflow-x-auto whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed">{reviewChange.change.markdown}</pre>
                        </div>
                      {:else}
                        <p class="mt-4 text-sm text-muted-foreground">
                          Delete the source note after its contents have been absorbed elsewhere.
                        </p>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </section>
    </section>
  </main>
</div>
