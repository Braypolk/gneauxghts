<script lang="ts">
  import { LoaderCircle, Search, ShieldOff, X } from '@lucide/svelte';
  import { onDestroy, onMount } from 'svelte';
  import { TauriChatApi } from '$lib/features/chat/api';
  import type {
    ChatNoteCandidate,
    ChatNotePolicy
  } from '$lib/features/chat/types';
  import {
    availableExclusionCandidates,
    sortedExcludedPolicies
  } from './excludedNotes';

  const api = new TauriChatApi();

  let policies = $state<ChatNotePolicy[]>([]);
  let query = $state('');
  let results = $state<ChatNoteCandidate[]>([]);
  let isLoading = $state(true);
  let isSearching = $state(false);
  let busyNoteId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchSequence = 0;

  const excluded = $derived(sortedExcludedPolicies(policies));
  const availableResults = $derived(
    availableExclusionCandidates(results, policies)
  );

  function errorText(value: unknown, fallback: string) {
    if (value instanceof Error && value.message.trim()) return value.message;
    if (typeof value === 'string' && value.trim()) return value;
    return fallback;
  }

  async function loadPolicies() {
    isLoading = true;
    error = null;
    try {
      policies = await api.listNotePolicies();
    } catch (loadError) {
      error = errorText(loadError, 'Unable to load excluded notes.');
    } finally {
      isLoading = false;
    }
  }

  async function searchNow() {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    const value = query.trim();
    const sequence = ++searchSequence;
    if (value.length < 2) {
      results = [];
      isSearching = false;
      return;
    }
    isSearching = true;
    error = null;
    try {
      const next = await api.searchNotesForPolicy(value, 12);
      if (sequence === searchSequence) results = next;
    } catch (searchError) {
      if (sequence === searchSequence) {
        results = [];
        error = errorText(searchError, 'Unable to search notes.');
      }
    } finally {
      if (sequence === searchSequence) isSearching = false;
    }
  }

  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void searchNow(), 220);
  }

  async function excludeNote(candidate: ChatNoteCandidate) {
    if (busyNoteId) return;
    busyNoteId = candidate.noteId;
    error = null;
    message = null;
    try {
      await api.setNoteExcluded(candidate.noteId, candidate.title, true);
      const now = Date.now();
      policies = [
        ...policies.filter((policy) => policy.noteId !== candidate.noteId),
        {
          noteId: candidate.noteId,
          notePath: candidate.notePath,
          title: candidate.title,
          disposition: 'excluded',
          updatedAtMillis: now
        }
      ];
      results = results.filter((result) => result.noteId !== candidate.noteId);
      message = `“${candidate.title}” is now excluded from AI.`;
    } catch (excludeError) {
      error = errorText(excludeError, 'Unable to exclude this note.');
    } finally {
      busyNoteId = null;
    }
  }

  async function allowNote(policy: ChatNotePolicy) {
    if (busyNoteId) return;
    busyNoteId = policy.noteId;
    error = null;
    message = null;
    try {
      await api.setNoteExcluded(policy.noteId, policy.title, false);
      policies = policies.filter(
        (candidate) =>
          candidate.noteId !== policy.noteId ||
          candidate.disposition !== 'excluded'
      );
      message = `“${policy.title}” can now be used by AI when the selected vault scope allows it.`;
      if (query.trim().length >= 2) await searchNow();
    } catch (allowError) {
      error = errorText(allowError, 'Unable to allow this note.');
    } finally {
      busyNoteId = null;
    }
  }

  onMount(() => {
    void loadPolicies();
  });

  onDestroy(() => {
    searchSequence += 1;
    if (searchTimer) clearTimeout(searchTimer);
  });
</script>

<section class="settings-section">
  <div class="flex items-start gap-3">
    <div class="rounded-xl bg-muted p-2 text-muted-foreground">
      <ShieldOff class="h-4 w-4" />
    </div>
    <div class="min-w-0">
      <h3 class="text-sm font-medium">Excluded notes</h3>
      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
        Excluded notes are never sent to AI or exposed through search, citations, or proposed changes,
        regardless of a conversation’s vault-access setting.
      </p>
    </div>
  </div>

  <div class="relative mt-4">
    <Search class="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
    <input
      class="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
      type="search"
      bind:value={query}
      placeholder="Find a note to exclude…"
      aria-label="Find a note to exclude"
      oninput={scheduleSearch}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void searchNow();
        }
      }}
    />
    {#if isSearching}
      <LoaderCircle class="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
    {:else if query}
      <button
        type="button"
        class="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Clear note search"
        onclick={() => {
          query = '';
          results = [];
          searchSequence += 1;
        }}
      >
        <X class="h-4 w-4" />
      </button>
    {/if}
  </div>

  {#if query.trim().length >= 2}
    <div class="mt-2 overflow-hidden rounded-xl border border-border/80">
      {#if isSearching && results.length === 0}
        <p class="px-3 py-3 text-xs text-muted-foreground">Searching notes…</p>
      {:else if availableResults.length === 0}
        <p class="px-3 py-3 text-xs text-muted-foreground">
          No additional notes match “{query.trim()}”.
        </p>
      {:else}
        <ul class="max-h-56 divide-y divide-border/70 overflow-y-auto" aria-label="Notes matching exclusion search">
          {#each availableResults as candidate (candidate.noteId)}
            <li class="flex items-center gap-3 px-3 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{candidate.title}</p>
                <p class="truncate text-[11px] text-muted-foreground">{candidate.notePath}</p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                disabled={busyNoteId !== null}
                onclick={() => void excludeNote(candidate)}
              >
                {busyNoteId === candidate.noteId ? 'Adding…' : 'Exclude'}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if query.length > 0}
    <p class="mt-2 text-xs text-muted-foreground">Type at least two characters to search.</p>
  {/if}

  <div class="mt-5 flex items-center justify-between">
    <h4 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Currently excluded
    </h4>
    {#if !isLoading}
      <span class="text-xs tabular-nums text-muted-foreground">{excluded.length}</span>
    {/if}
  </div>

  {#if isLoading}
    <div class="mt-2 flex items-center gap-2 rounded-xl border border-border/70 px-3 py-3 text-xs text-muted-foreground">
      <LoaderCircle class="h-3.5 w-3.5 animate-spin" /> Loading exclusions…
    </div>
  {:else if excluded.length === 0}
    <p class="mt-2 rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
      No notes are excluded.
    </p>
  {:else}
    <ul class="mt-2 max-h-72 divide-y divide-border/70 overflow-y-auto rounded-xl border border-border/80" aria-label="Excluded notes">
      {#each excluded as policy (policy.noteId)}
        <li class="flex items-center gap-3 px-3 py-2.5">
          <ShieldOff class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{policy.title}</p>
            <p class="truncate text-[11px] text-muted-foreground">
              {policy.notePath ?? 'Note is no longer present in the vault'}
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled={busyNoteId !== null}
            onclick={() => void allowNote(policy)}
          >
            {busyNoteId === policy.noteId ? 'Removing…' : 'Allow'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
    <p class="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
      {error}
    </p>
  {:else if message}
    <p class="mt-3 text-xs text-muted-foreground" role="status">{message}</p>
  {/if}
</section>
