<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Dialog } from 'bits-ui';
  import { Plus, RotateCcw, Search, X } from '@lucide/svelte';
  import {
    formatShortcutBinding,
    getEffectiveKeyboardShortcutBindings,
    getShortcutBindingConflicts,
    getShortcutDefinition,
    isKeyboardShortcutCustomized,
    keyboardShortcuts,
    keyboardShortcutDefinitions,
    keyboardShortcutGroups,
    recordShortcutBindingFromEvent,
    resetAllKeyboardShortcuts,
    resetKeyboardShortcutBinding,
    setKeyboardShortcutBindings,
    type KeyboardShortcutId
  } from '#lib/keyboardShortcuts.svelte.js';
  import ShortcutBinding from '#lib/ui/ShortcutBinding.svelte';
  import { matchesKeyboardShortcutSearch } from './keyboardShortcutSearch';

  let { targetAnchor = null }: { targetAnchor?: string | null } = $props();
  let searchQuery = $state('');
  let groupFilter = $state('all');
  let recording = $state<{ id: KeyboardShortcutId; index: number | null } | null>(null);
  let candidate = $state('');
  const recordingModifiersOnly = $derived(recording !== null && getShortcutDefinition(recording.id).activation === 'holdModifiers');
  const sortedDefinitions = [...keyboardShortcutDefinitions].sort((a, b) => a.label.localeCompare(b.label));
  const groupsById = Object.fromEntries(keyboardShortcutGroups.map(group => [group.id, group.label]));
  const hasCustomizations = $derived(keyboardShortcutDefinitions.some(definition => isKeyboardShortcutCustomized(definition.id)));
  const conflicts = $derived(recording && candidate ? getShortcutBindingConflicts(recording.id, candidate) : []);
  const rows = $derived(sortedDefinitions.map(definition => {
    const customized = isKeyboardShortcutCustomized(definition.id);
    return { definition, bindings: getEffectiveKeyboardShortcutBindings(definition.id),
      source: customized ? 'User' : 'Default', customized };
  }));
  const filteredRows = $derived(rows.filter(row => {
    if (groupFilter !== 'all' && row.definition.group !== groupFilter) return false;
    return (row.bindings.length ? row.bindings : ['']).some(binding =>
      matchesKeyboardShortcutSearch(searchQuery, binding, [row.definition.label,
        row.definition.description, row.definition.id, groupsById[row.definition.group], row.source]));
  }));

  $effect(() => {
    if (targetAnchor?.startsWith('shortcut-')) { searchQuery = ''; groupFilter = 'all'; }
  });
  $effect(() => { keyboardShortcuts.recording = recording !== null; });
  onDestroy(() => { keyboardShortcuts.recording = false; });

  function startRecording(id: KeyboardShortcutId, index: number | null) {
    candidate = '';
    keyboardShortcuts.recording = true;
    recording = { id, index };
  }
  function closeRecording() { recording = null; candidate = ''; keyboardShortcuts.recording = false; }
  function saveRecording() {
    if (!recording || !candidate) return;
    const bindings = [...getEffectiveKeyboardShortcutBindings(recording.id)];
    if (recording.index === null) bindings.push(candidate);
    else bindings[recording.index] = candidate;
    setKeyboardShortcutBindings(recording.id, bindings);
    closeRecording();
  }
  function handleRecording(event: KeyboardEvent) {
    if (!recording) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.isComposing || event.repeat) return;
    const plainKey = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plainKey && event.key === 'Escape') { closeRecording(); return; }
    if (plainKey && event.key === 'Enter' && candidate) { saveRecording(); return; }
    const binding = recordShortcutBindingFromEvent(event, { modifiersOnly: recordingModifiersOnly });
    if (binding) candidate = binding;
  }
  function removeBinding(id: KeyboardShortcutId, index: number) {
    setKeyboardShortcutBindings(id, getEffectiveKeyboardShortcutBindings(id).filter((_, current) => current !== index));
  }
</script>

<svelte:window onkeydowncapture={handleRecording} />

<div class="shortcuts-panel" data-settings-anchor="shortcuts">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">Click a keybinding to change it. Use + to add another.</p>
    <button type="button" class="shortcut-text-action" disabled={!hasCustomizations} onclick={resetAllKeyboardShortcuts}>Reset all to default</button>
  </div>
  <div class="mb-4 flex flex-wrap gap-2">
    <label class="flex min-w-40 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <Search size={15} class="text-muted-foreground" />
      <input class="min-w-0 flex-1 bg-transparent text-sm outline-none" bind:value={searchQuery} placeholder="Search commands or keys (e.g. cmd+shift)" aria-label="Filter shortcuts" autocomplete="off" />
    </label>
    <select class="rounded-lg border border-border bg-background px-3 text-sm" aria-label="Shortcut category" bind:value={groupFilter}>
      <option value="all">All commands</option>
      {#each keyboardShortcutGroups as group}<option value={group.id}>{group.label}</option>{/each}
    </select>
  </div>
  <p class="mb-2 text-xs text-muted-foreground" aria-live="polite">{filteredRows.length} {filteredRows.length === 1 ? 'command' : 'commands'}</p>
  <div class="shortcut-table overflow-auto rounded-lg border border-border/70">
    <table class="w-full table-fixed border-collapse text-left text-sm" aria-label="Keyboard shortcuts">
      <colgroup><col class="command-column" /><col class="binding-column" /><col class="source-column" /></colgroup>
      <thead class="bg-muted/60 text-xs text-muted-foreground">
        <tr><th scope="col" class="px-3 py-2.5 font-semibold">Command</th><th scope="col" class="px-3 py-2.5 font-semibold">Keybinding</th><th scope="col" class="px-3 py-2.5 font-semibold">Source</th></tr>
      </thead>
      <tbody>
        {#each filteredRows as row (row.definition.id)}
          <tr class="shortcut-row border-t border-border/40 hover:bg-accent/60 focus-within:bg-accent/60" data-shortcut-id={row.definition.id} data-settings-anchor={`shortcut-${row.definition.id}`}>
            <td class="px-3 py-2" ondblclick={() => startRecording(row.definition.id, row.bindings.length ? 0 : null)}>
              <span class="block font-medium" title={row.definition.description}>{row.definition.label}</span>
              <span class="sr-only">{groupsById[row.definition.group]}</span>
            </td>
            <td class="px-3 py-2">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                {#each row.bindings as binding, index (binding)}
                  {@const bindingConflicts = getShortcutBindingConflicts(row.definition.id, binding)}
                  {#if index > 0}<span class="text-xs text-muted-foreground">or</span>{/if}
                  <div>
                    <div class="inline-flex items-center rounded border border-border/60">
                      <button type="button" class="binding-button rounded px-1.5 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Change ${row.definition.label} shortcut, ${formatShortcutBinding(binding)}`} onclick={() => startRecording(row.definition.id, index)}><ShortcutBinding {binding} /></button>
                      <button type="button" class="shortcut-icon shortcut-remove" title="Remove keybinding" aria-label={`Remove ${formatShortcutBinding(binding)} from ${row.definition.label}`} onclick={() => removeBinding(row.definition.id, index)}><X size={12} /></button>
                    </div>
                    {#if bindingConflicts.length}<p class="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Also used by: {bindingConflicts.map(id => getShortcutDefinition(id).label).join(', ')}</p>{/if}
                  </div>
                {:else}
                  <button type="button" class="binding-button rounded px-1.5 py-1 text-left text-xs italic text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Assign keybinding for ${row.definition.label}`} onclick={() => startRecording(row.definition.id, null)}>Unassigned</button>
                {/each}
              </div>
            </td>
            <td class="px-3 py-2 align-middle">
              <div class="flex flex-wrap items-center justify-between gap-1">
                <span class="text-xs text-muted-foreground">{row.source}</span>
                <div class="flex items-center">
                  <button type="button" class="shortcut-icon" title="Add keybinding" aria-label={`Add keybinding for ${row.definition.label}`} onclick={() => startRecording(row.definition.id, null)}><Plus size={14} /></button>
                  {#if row.customized}<button type="button" class="shortcut-icon" title="Reset command to default" aria-label={`Reset ${row.definition.label} to default`} onclick={() => resetKeyboardShortcutBinding(row.definition.id)}><RotateCcw size={13} /></button>{/if}
                </div>
              </div>
            </td>
          </tr>
        {/each}
        {#if !filteredRows.length}<tr><td colspan="3" class="px-3 py-8 text-center text-muted-foreground">No shortcuts match your search.</td></tr>{/if}
      </tbody>
    </table>
  </div>
</div>

<Dialog.Root open={recording !== null} onOpenChange={open => { if (!open) closeRecording(); }}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-80 bg-black/35 backdrop-blur-sm" />
    <Dialog.Content class="fixed top-1/2 left-1/2 z-90 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl">
      <Dialog.Title class="font-semibold">{recording?.index === null ? 'Add keybinding' : 'Change keybinding'}</Dialog.Title>
      <Dialog.Description class="mt-1 text-sm text-muted-foreground">{recording ? getShortcutDefinition(recording.id).label : ''}. {recordingModifiersOnly ? 'Hold your desired modifiers, release them, then press Enter to save.' : 'Press your desired keys, then Enter to save.'} Escape cancels.</Dialog.Description>
      <div class="my-5 flex min-h-16 items-center justify-center rounded-lg border border-border bg-muted/40 text-lg" aria-live="polite" data-testid="shortcut-recording">
        {#if candidate}<ShortcutBinding binding={candidate} />{:else}<span class="text-sm text-muted-foreground">Press a key combination…</span>{/if}
      </div>
      {#if conflicts.length}<p class="mb-4 text-xs text-amber-700 dark:text-amber-300">Also assigned to {conflicts.map(id => getShortcutDefinition(id).label).join(', ')}. Both commands will keep this binding.</p>{/if}
      <div class="flex flex-wrap items-center justify-between gap-2">
        {#if !recordingModifiersOnly}<button type="button" class="shortcut-text-action" onclick={() => candidate = 'Escape'}>Use Escape</button>{/if}
        <div class="flex gap-2"><button type="button" class="shortcut-text-action" onclick={closeRecording}>Cancel</button><button type="button" class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40" disabled={!candidate} onclick={saveRecording}>Save</button></div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .shortcuts-panel { container-type: inline-size; }
  table { min-width: 640px; }
  .command-column { width: 36%; }
  .binding-column { width: 44%; }
  .source-column { width: 20%; }
  .shortcut-table { max-height: min(65dvh, 48rem); }
  th { position: sticky; top: 0; z-index: 1; background: var(--muted); }
  .shortcut-row td { padding-top: 0.2rem; padding-bottom: 0.2rem; }
  .shortcut-row:nth-child(even) { background-color: color-mix(in srgb, var(--muted) 22%, transparent); }
  .shortcut-icon { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: 0.3rem; color: var(--muted-foreground); }
  .shortcut-icon:hover { background: var(--muted); color: var(--foreground); }
  .shortcut-icon:focus-visible { outline: 2px solid var(--ring); }
  .shortcut-remove { width: 1.5rem; height: 1.5rem; }
  .shortcut-text-action { border-radius: 0.4rem; padding: 0.4rem 0.6rem; font-size: 0.75rem; color: var(--muted-foreground); }
  .shortcut-text-action:hover { background: var(--accent); color: var(--foreground); }
  .shortcut-text-action:disabled { opacity: 0.4; }
  @media (any-pointer: coarse) { .shortcut-icon { min-width: 2.75rem; min-height: 2.75rem; } }
</style>
