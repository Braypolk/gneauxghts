<script lang="ts">
  import {
    formatShortcutBinding,
    getDefaultKeyboardShortcutBinding,
    getKeyboardShortcutConflicts,
    getShortcutDefinition,
    isKeyboardShortcutCustomized,
    keyboardShortcuts,
    keyboardShortcutDefinitions,
    keyboardShortcutGroups,
    recordShortcutBindingFromEvent,
    resetAllKeyboardShortcuts,
    resetKeyboardShortcutBinding,
    setKeyboardShortcutBinding,
    type KeyboardShortcutDefinition,
    type KeyboardShortcutId
  } from '$lib/keyboardShortcuts.svelte';
  import ShortcutBinding from '$lib/ui/ShortcutBinding.svelte';

  const groupedDefinitions = keyboardShortcutGroups.map((group) => ({
    ...group,
    items: keyboardShortcutDefinitions.filter((definition) => definition.group === group.id)
  }));

  let recordingShortcutId = $state<KeyboardShortcutId | null>(null);
  let searchQuery = $state('');
  const conflictMap = $derived(getKeyboardShortcutConflicts(keyboardShortcuts.bindings));
  const hasCustomizations = $derived(
    keyboardShortcutDefinitions.some((definition) =>
      isKeyboardShortcutCustomized(definition.id, keyboardShortcuts.bindings)
    )
  );
  const normalizedSearchQuery = $derived(searchQuery.trim().toLowerCase());
  const filteredGroups = $derived(
    groupedDefinitions
      .map((group) => ({
        ...group,
        items: group.items.filter((definition) => matchesSearch(definition, normalizedSearchQuery))
      }))
      .filter((group) => group.items.length > 0)
  );
  const visibleShortcutCount = $derived(
    filteredGroups.reduce((count, group) => count + group.items.length, 0)
  );

  function toggleRecording(id: KeyboardShortcutId) {
    recordingShortcutId = recordingShortcutId === id ? null : id;
  }

  function stopRecording(id: KeyboardShortcutId) {
    if (recordingShortcutId === id) {
      recordingShortcutId = null;
    }
  }

  function handleRecordKeydown(id: KeyboardShortcutId, event: KeyboardEvent) {
    if (recordingShortcutId !== id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const binding = recordShortcutBindingFromEvent(event);
    if (!binding) {
      return;
    }

    setKeyboardShortcutBinding(id, binding);
    recordingShortcutId = null;
  }

  function handleWindowKeydownCapture(event: KeyboardEvent) {
    if (!recordingShortcutId) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      recordingShortcutId = null;
      return;
    }

    handleRecordKeydown(recordingShortcutId, event);
  }

  function clearShortcut(id: KeyboardShortcutId) {
    setKeyboardShortcutBinding(id, '');
    stopRecording(id);
  }

  function describeConflicts(definition: KeyboardShortcutDefinition) {
    const conflicts = conflictMap[definition.id] ?? [];
    if (conflicts.length === 0) {
      return '';
    }

    return conflicts.map((id) => getShortcutDefinition(id).label).join(', ');
  }

  function matchesSearch(definition: KeyboardShortcutDefinition, query: string) {
    if (query === '') {
      return true;
    }

    const haystack = [
      definition.label,
      definition.description,
      formatShortcutBinding(keyboardShortcuts.bindings[definition.id]),
      formatShortcutBinding(getDefaultKeyboardShortcutBinding(definition.id)),
      definition.group
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  }
</script>

<svelte:window onkeydowncapture={handleWindowKeydownCapture} />

<div class="space-y-6">
  <div class="flex flex-col gap-4 rounded-2xl border border-border/70 bg-background/40 px-4 py-4 sm:px-5">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p class="text-sm font-medium">Custom keyboard shortcuts</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Click a shortcut button, press new keys, or clear it to disable. Conflicts are allowed but flagged.
        </p>
      </div>

      <button
        class="inline-flex items-center justify-center rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        type="button"
        disabled={!hasCustomizations}
        onclick={() => {
          resetAllKeyboardShortcuts();
          recordingShortcutId = null;
        }}
        >
          Reset all to default
        </button>
      </div>

    <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <label class="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2">
        <span class="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Search
        </span>
        <input
          class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          type="text"
          bind:value={searchQuery}
          placeholder="Filter shortcuts"
          autocomplete="off"
        />
      </label>
      <p class="text-xs text-muted-foreground lg:text-right">
        Showing {visibleShortcutCount} of {keyboardShortcutDefinitions.length}
      </p>
    </div>
  </div>

  {#if filteredGroups.length === 0}
    <div class="rounded-2xl border border-dashed border-border/70 bg-background/30 px-4 py-6 text-sm text-muted-foreground">
      No shortcuts match “{searchQuery.trim()}”.
    </div>
  {/if}

  {#each filteredGroups as group}
    <section class="space-y-3 rounded-2xl border border-border/70 bg-background/40 px-4 py-4 sm:px-5">
      <header class="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 class="text-sm font-semibold">{group.label}</h3>
        <p class="text-xs text-muted-foreground">{group.description}</p>
      </header>

      <div class="space-y-2">
        {#each group.items as definition}
          {@const currentBinding = keyboardShortcuts.bindings[definition.id]}
          {@const isCustomized = isKeyboardShortcutCustomized(definition.id, keyboardShortcuts.bindings)}
          {@const conflictDescription = describeConflicts(definition)}
          <div class="rounded-xl border border-border/60 bg-background/60 px-3 py-3">
            <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p class="text-sm font-medium">{definition.label}</p>
                  {#if currentBinding === ''}
                    <span class="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                      Disabled
                    </span>
                  {/if}
                  {#if isCustomized}
                    <span class="rounded-full bg-foreground/8 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Custom
                    </span>
                  {/if}
                </div>
                <p class="mt-1 text-xs text-muted-foreground">{definition.description}</p>
                <p class="mt-1 text-[11px] text-muted-foreground">
                  Default: <ShortcutBinding binding={getDefaultKeyboardShortcutBinding(definition.id)} />
                </p>
                {#if conflictDescription}
                  <p class="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                    Also used by: {conflictDescription}
                  </p>
                {/if}
              </div>

              <div class="flex flex-col gap-2 xl:min-w-[22rem] xl:items-end">
                <button
                  type="button"
                  class={`inline-flex min-h-10 items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                    recordingShortcutId === definition.id
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border/70 bg-background hover:bg-accent'
                  }`}
                  aria-pressed={recordingShortcutId === definition.id}
                  onkeydown={(event) => handleRecordKeydown(definition.id, event)}
                  onblur={() => stopRecording(definition.id)}
                  onclick={() => toggleRecording(definition.id)}
                >
                  {#if recordingShortcutId === definition.id}
                    Press shortcut…
                  {:else}
                    <ShortcutBinding binding={currentBinding} />
                  {/if}
                </button>

                <div class="flex flex-wrap gap-2 xl:justify-end">
                  <button
                    type="button"
                    class="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                    onclick={() => clearShortcut(definition.id)}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    class="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
                    disabled={!isCustomized}
                    onclick={() => {
                      resetKeyboardShortcutBinding(definition.id);
                      stopRecording(definition.id);
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>
