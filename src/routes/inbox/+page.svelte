<script lang="ts">
  import { onMount } from 'svelte';
  import { buildReviewChanges } from '$lib/features/inbox/reviewChanges';
  import {
    createInboxStore,
    formatInboxStatusLabel,
    formatInboxTimestamp,
    inboxGroupLabels,
    inboxStatusBadgeClass,
    type InboxGroupKey
  } from '$lib/features/inbox/store';
  import ProposalReviewList from '$lib/features/proposals/ProposalReviewList.svelte';
  import {
    activeProposalSession,
    getSelectedApprovedChangeCount,
    toggleProposalChange,
    toggleProposalOp
  } from '$lib/features/proposals/session';
  const inboxStore = createInboxStore();

  let reviewChanges = $derived.by(() => {
    if (!$inboxStore.selectedItem) {
      return [];
    }

    if (
      $inboxStore.selectedItem.status === 'pendingApproval' &&
      $activeProposalSession?.itemId === $inboxStore.selectedItem.id
    ) {
      return $activeProposalSession.reviewChanges;
    }

    return buildReviewChanges($inboxStore.selectedItem.changePreviews);
  });

  function selectedApprovedChangeCount() {
    return getSelectedApprovedChangeCount($activeProposalSession);
  }

  onMount(() => {
    inboxStore.initialize();
    return () => {
      inboxStore.dispose();
    };
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
              disabled={$inboxStore.isMutating || !$inboxStore.hasClearableItems}
              onclick={() => void inboxStore.clearInbox()}
            >
              Clear
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {#if $inboxStore.isLoading && $inboxStore.items.length === 0}
            <div class="mx-2 rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center">
              <p class="text-sm font-medium text-foreground">Loading inbox...</p>
              <p class="mt-1 text-xs text-muted-foreground">Fetching recent AI activity.</p>
            </div>
          {:else if $inboxStore.items.length === 0}
            <div class="mx-2 rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center">
              <p class="text-sm font-medium text-foreground">No inbox items yet</p>
              <p class="mt-1 text-xs text-muted-foreground">Run an AI flow and it will appear here.</p>
            </div>
          {:else}
            <div class="space-y-6">
              {#each (Object.keys(inboxGroupLabels) as InboxGroupKey[]) as groupKey (groupKey)}
                {@const groupItems = $inboxStore.groupedItems[groupKey]}
                {#if groupItems.length > 0}
                  <section>
                    <div class="mb-2 flex items-center justify-between px-3">
                      <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        {inboxGroupLabels[groupKey]}
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
                            $inboxStore.selectedId === item.id
                              ? 'border-primary/40 bg-primary/10 shadow-md shadow-primary/10 ring-1 ring-primary/20'
                              : 'border-border/70 bg-background/70 hover:border-border hover:bg-accent/80'
                          }`}
                          onclick={() => void inboxStore.selectInboxItem(item.id, { preserveSelections: false })}
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
        {#if $inboxStore.errorMessage}
          <div class="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-destructive">Error</p>
            <p class="mt-1 text-sm text-destructive">{$inboxStore.errorMessage}</p>
          </div>
        {/if}

        {#if !$inboxStore.selectedItem}
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
                    {$inboxStore.selectedItem.actionLabel}
                  </span>
                  <span class={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${inboxStatusBadgeClass($inboxStore.selectedItem.status)}`}>
                    {formatInboxStatusLabel($inboxStore.selectedItem.status)}
                  </span>
                </div>
                <h1 class="mt-3 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{$inboxStore.selectedItem.title}</h1>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                {#if $inboxStore.selectedItem.status === 'pendingApproval'}
                  <button
                    class="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={$inboxStore.isMutating}
                    onclick={() => void inboxStore.approveSelectedChanges()}
                  >
                    {selectedApprovedChangeCount() === 0 ? 'Reject All' : 'Approve Selected'}
                  </button>
                  <button
                    class="rounded-full border border-rose-400/35 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={$inboxStore.isMutating}
                    onclick={() => void inboxStore.runInboxAction('reject_inbox_item')}
                  >
                    Reject
                  </button>
                {/if}

                {#if $inboxStore.selectedItem.status === 'failed' || $inboxStore.selectedItem.status === 'stale' || $inboxStore.selectedItem.status === 'rejected'}
                  <button
                    class="rounded-full border border-sky-400/35 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={$inboxStore.isMutating}
                    onclick={() => void inboxStore.runInboxAction('retry_inbox_item')}
                  >
                    Retry
                  </button>
                {/if}
              </div>
            </div>

            <div class="grid gap-4 xl:grid-cols-3">
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Source note</p>
                <p class="mt-2 text-sm font-semibold break-all text-foreground">{$inboxStore.selectedItem.sourceTitle}</p>
                <p class="mt-1 text-xs text-muted-foreground break-all">{$inboxStore.selectedItem.sourcePath}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Provider</p>
                <p class="mt-2 text-sm font-semibold text-foreground">{$inboxStore.selectedItem.providerKind ?? 'pending'}</p>
                <p class="mt-1 text-xs text-muted-foreground">{$inboxStore.selectedItem.model ?? 'Model pending'}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Timestamps</p>
                <p class="mt-2 text-sm font-semibold text-foreground">{formatInboxTimestamp($inboxStore.selectedItem.createdAtMillis)}</p>
                <p class="mt-1 text-xs text-muted-foreground">Updated {formatInboxTimestamp($inboxStore.selectedItem.updatedAtMillis)}</p>
              </div>
            </div>

            {#if $inboxStore.selectedItem.failureReason}
              <div class="rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive">Failure reason</p>
                <p class="mt-2 text-sm leading-relaxed text-destructive">{$inboxStore.selectedItem.failureReason}</p>
              </div>
            {/if}

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4 shadow-sm shadow-black/5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Proposed changes</p>
              <div class="mt-4">
                <ProposalReviewList
                  {reviewChanges}
                  showOpenButtons={$inboxStore.selectedItem.status === 'pendingApproval'}
                  onToggleChange={toggleProposalChange}
                  onToggleOp={toggleProposalOp}
                  onOpenPath={(path) => void inboxStore.openProposalPathInNotepad(path)}
                />
              </div>
            </div>
          </div>
        {/if}
      </section>
    </section>
  </main>
</div>
