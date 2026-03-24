<script lang="ts">
  import type {
    RequestMagicLinkResponse,
    SyncConflict,
    SyncConflictDetail,
    SyncStatus
  } from '$lib/types/sync';

  type ConflictDiffRow = {
    lineNumber: number;
    localLine: string;
    remoteLine: string;
    kind: 'same' | 'changed' | 'local-only' | 'remote-only';
  };

  let {
    syncStatus,
    syncConflicts,
    syncBaseUrlInput = $bindable(''),
    syncEmailInput = $bindable(''),
    magicLinkTokenInput = $bindable(''),
    lastMagicLinkResponse,
    activeConflictNoteId,
    activeConflictDetail,
    isRequestingMagicLink,
    isCompletingSyncSignIn,
    isSyncingNow,
    isTogglingSyncPause,
    isSigningOutSync,
    isLoadingConflictDetail,
    dismissingConflictNoteIds,
    resolvingConflictNoteIds,
    syncUiError,
    syncUiMessage,
    requestMagicLink,
    completeSyncSignIn,
    runSyncNow,
    signOutSync,
    dismissSyncConflict,
    toggleSyncConflictDetail,
    resolveSyncConflict,
    toggleSyncPaused,
    formatSyncTimestamp,
    buildConflictDiffRows,
    conflictRowClass
  }: {
    syncStatus: SyncStatus | null;
    syncConflicts: SyncConflict[];
    syncBaseUrlInput: string;
    syncEmailInput: string;
    magicLinkTokenInput: string;
    lastMagicLinkResponse: RequestMagicLinkResponse | null;
    activeConflictNoteId: string | null;
    activeConflictDetail: SyncConflictDetail | null;
    isRequestingMagicLink: boolean;
    isCompletingSyncSignIn: boolean;
    isSyncingNow: boolean;
    isTogglingSyncPause: boolean;
    isSigningOutSync: boolean;
    isLoadingConflictDetail: boolean;
    dismissingConflictNoteIds: string[];
    resolvingConflictNoteIds: string[];
    syncUiError: string | null;
    syncUiMessage: string | null;
    requestMagicLink: () => Promise<void>;
    completeSyncSignIn: () => Promise<void>;
    runSyncNow: () => Promise<void>;
    signOutSync: (keepServerUrl?: boolean) => Promise<void>;
    dismissSyncConflict: (noteId: string) => Promise<void>;
    toggleSyncConflictDetail: (noteId: string) => Promise<void>;
    resolveSyncConflict: (noteId: string, strategy: 'keep-local' | 'keep-remote') => Promise<void>;
    toggleSyncPaused: () => Promise<void>;
    formatSyncTimestamp: (value: number | null) => string;
    buildConflictDiffRows: (detail: SyncConflictDetail | null) => ConflictDiffRow[];
    conflictRowClass: (kind: ConflictDiffRow['kind']) => string;
  } = $props();
</script>

<div class="border-t border-border/70 px-6 py-5">
  <div class="flex flex-col gap-4">
    <div>
      <p class="text-sm font-medium">Sync</p>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Connect this device to a hosted or self-hosted sync server. Desktop now syncs in the background, but manual sync is still available as a direct override.
      </p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
        <span class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Server URL</span>
        <input
          class="mt-3 w-full bg-transparent text-sm font-medium outline-none"
          bind:value={syncBaseUrlInput}
          placeholder="http://localhost:8787"
        />
      </label>

      <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
        <span class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Email</span>
        <input
          class="mt-3 w-full bg-transparent text-sm font-medium outline-none"
          bind:value={syncEmailInput}
          placeholder="you@example.com"
        />
      </label>
    </div>

    <div class="grid gap-4 md:grid-cols-[1fr_auto_auto]">
      <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
        <span class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Magic Link Token</span>
        <input
          class="mt-3 w-full bg-transparent text-sm font-medium outline-none"
          bind:value={magicLinkTokenInput}
          placeholder="Paste the token from the magic link flow"
        />
      </label>

      <button
        class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
        type="button"
        disabled={isRequestingMagicLink}
        onclick={() => void requestMagicLink()}
      >
        {isRequestingMagicLink ? 'Requesting…' : 'Request magic link'}
      </button>

      <button
        class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
        type="button"
        disabled={isCompletingSyncSignIn}
        onclick={() => void completeSyncSignIn()}
      >
        {isCompletingSyncSignIn ? 'Signing in…' : 'Complete sign-in'}
      </button>
    </div>

    {#if lastMagicLinkResponse}
      <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Magic link</p>
        <p class="mt-2 text-sm font-medium">
          Expires {new Date(lastMagicLinkResponse.expiresAt).toLocaleString()}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {#if lastMagicLinkResponse.magicLinkToken}
            Development mode returned a token directly. It has been copied into the token field above.
          {:else}
            The server accepted the request. Use your normal magic link delivery path to retrieve the token.
          {/if}
        </p>
      </div>
    {/if}

    {#if syncStatus}
      <div class="grid gap-4 md:grid-cols-4">
        <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Device</p>
          <p class="mt-2 text-sm font-medium break-all">{syncStatus.deviceId}</p>
        </div>
        <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tracked notes</p>
          <p class="mt-2 text-sm font-medium">{syncStatus.trackedNoteCount}</p>
          <p class="mt-1 text-xs text-muted-foreground">{syncStatus.dirtyNoteCount} dirty</p>
        </div>
        <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Conflicts</p>
          <p class="mt-2 text-sm font-medium">{syncStatus.conflictedNoteCount}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {#if syncStatus.paused}
              Paused on this device
            {:else if syncStatus.linkedVault.linked}
              Linked to remote vault
            {:else}
              Not signed in
            {/if}
          </p>
        </div>
        <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last sync</p>
          <p class="mt-2 text-sm font-medium">{formatSyncTimestamp(syncStatus.lastSyncAtMillis)}</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button
          class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
          type="button"
          disabled={isSyncingNow || syncStatus.paused}
          onclick={() => void runSyncNow()}
        >
          {isSyncingNow ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
          type="button"
          disabled={isTogglingSyncPause}
          onclick={() => void toggleSyncPaused()}
        >
          {#if isTogglingSyncPause}
            {syncStatus.paused ? 'Resuming…' : 'Pausing…'}
          {:else}
            {syncStatus.paused ? 'Resume syncing' : 'Pause syncing'}
          {/if}
        </button>
        <button
          class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
          type="button"
          disabled={isSigningOutSync || !syncStatus.linkedVault.linked}
          onclick={() => void signOutSync(true)}
        >
          {isSigningOutSync ? 'Signing out…' : 'Sign out'}
        </button>
        <p class="text-xs text-muted-foreground break-all">
          Server: {syncStatus.syncBaseUrl ?? 'not configured'} · Vault: {syncStatus.linkedVault.vaultId ?? 'not linked'}
        </p>
      </div>

      {#if syncStatus.paused}
        <div class="rounded-3xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Syncing is paused on this device. Local edits still save normally and will remain dirty until you resume.
        </div>
      {/if}

      {#if syncUiMessage}
        <div class="rounded-3xl border border-emerald-300/60 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {syncUiMessage}
        </div>
      {/if}

      {#if syncUiError}
        <div class="rounded-3xl border border-rose-300/60 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {syncUiError}
        </div>
      {/if}

      {#if syncStatus.lastSyncError}
        <div class="rounded-3xl border border-rose-300/60 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {syncStatus.lastSyncError}
        </div>
      {/if}

      <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Conflict details</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Conflicts create a preserved copy locally. Dismissing a conflict only clears the sync badge for that note.
            </p>
          </div>
          <p class="text-sm font-medium">{syncConflicts.length}</p>
        </div>

        {#if syncConflicts.length === 0}
          <p class="mt-4 text-sm text-muted-foreground">No outstanding sync conflicts.</p>
        {:else}
          <div class="mt-4 flex flex-col gap-3">
            {#each syncConflicts as conflict}
              <div class="rounded-2xl border border-border/70 bg-card/80 px-4 py-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium break-words">{conflict.title}</p>
                    <p class="mt-1 text-xs text-muted-foreground break-all">{conflict.notePath}</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      {formatSyncTimestamp(conflict.updatedAtMillis)} · {conflict.deleted ? 'trashed' : 'local conflicted copy'}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      class="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                      type="button"
                      disabled={isLoadingConflictDetail && activeConflictNoteId !== conflict.noteId}
                      onclick={() => void toggleSyncConflictDetail(conflict.noteId)}
                    >
                      {#if activeConflictNoteId === conflict.noteId}
                        Hide diff
                      {:else if isLoadingConflictDetail}
                        Loading…
                      {:else}
                        View diff
                      {/if}
                    </button>
                    <button
                      class="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                      type="button"
                      disabled={dismissingConflictNoteIds.includes(conflict.noteId)}
                      onclick={() => void dismissSyncConflict(conflict.noteId)}
                    >
                      {dismissingConflictNoteIds.includes(conflict.noteId) ? 'Dismissing…' : 'Dismiss'}
                    </button>
                  </div>
                </div>

                {#if activeConflictNoteId === conflict.noteId && activeConflictDetail}
                  <div class="mt-4 rounded-2xl border border-border/70 bg-background/80 p-4">
                    <div class="flex flex-col gap-1">
                      <p class="text-sm font-medium">Frozen conflict snapshots</p>
                      <p class="text-xs text-muted-foreground">
                        Original note: {activeConflictDetail.originalNotePath ?? 'unknown'}
                      </p>
                      <p class="text-xs text-muted-foreground">
                        The conflicted copy is frozen locally. This viewer shows the local version that conflicted against the remote canonical version.
                      </p>
                    </div>

                    <div class="mt-4 grid gap-4 xl:grid-cols-2">
                      <div class="rounded-2xl border border-border/70 bg-card/80 overflow-hidden">
                        <div class="border-b border-border/70 px-4 py-2">
                          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Local snapshot</p>
                        </div>
                        <div class="max-h-96 overflow-auto font-mono text-xs">
                          {#each buildConflictDiffRows(activeConflictDetail) as row}
                            <div class={`grid grid-cols-[3rem_1fr] gap-3 px-3 py-1 ${conflictRowClass(row.kind)}`}>
                              <span class="text-right text-muted-foreground">{row.lineNumber}</span>
                              <pre class="whitespace-pre-wrap break-words text-foreground">{row.localLine || ' '}</pre>
                            </div>
                          {/each}
                        </div>
                      </div>

                      <div class="rounded-2xl border border-border/70 bg-card/80 overflow-hidden">
                        <div class="border-b border-border/70 px-4 py-2">
                          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Remote snapshot</p>
                        </div>
                        <div class="max-h-96 overflow-auto font-mono text-xs">
                          {#each buildConflictDiffRows(activeConflictDetail) as row}
                            <div class={`grid grid-cols-[3rem_1fr] gap-3 px-3 py-1 ${conflictRowClass(row.kind)}`}>
                              <span class="text-right text-muted-foreground">{row.lineNumber}</span>
                              <pre class="whitespace-pre-wrap break-words text-foreground">{row.remoteLine || ' '}</pre>
                            </div>
                          {/each}
                        </div>
                      </div>
                    </div>

                    <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span class="rounded-full border border-border px-3 py-1">Changed: amber</span>
                      <span class="rounded-full border border-border px-3 py-1">Local only: green</span>
                      <span class="rounded-full border border-border px-3 py-1">Remote only: blue</span>
                    </div>

                    <div class="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                        type="button"
                        disabled={resolvingConflictNoteIds.includes(conflict.noteId)}
                        onclick={() => void resolveSyncConflict(conflict.noteId, 'keep-local')}
                      >
                        {resolvingConflictNoteIds.includes(conflict.noteId) ? 'Resolving…' : 'Keep local'}
                      </button>
                      <button
                        class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                        type="button"
                        disabled={resolvingConflictNoteIds.includes(conflict.noteId)}
                        onclick={() => void resolveSyncConflict(conflict.noteId, 'keep-remote')}
                      >
                        {resolvingConflictNoteIds.includes(conflict.noteId) ? 'Resolving…' : 'Keep remote'}
                      </button>
                      <p class="text-xs text-muted-foreground">
                        `Keep local` restores your frozen local snapshot into the canonical note and queues it for sync. `Keep remote` discards the frozen local conflict copy.
                      </p>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
