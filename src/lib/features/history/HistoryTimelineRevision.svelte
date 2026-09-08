<script lang="ts">
  import { tick } from 'svelte';
  import { Pencil } from '@lucide/svelte';
  import type { HistoryRevisionRecord } from './historyModeMachine';
  import HistoryRevisionSummary from './HistoryRevisionSummary.svelte';
  import RevisionNameEditor from './RevisionNameEditor.svelte';

  let { revision, selected, busy, renamingRevisionId = $bindable(null), onSelect, onSave, onRemove }: {
    revision: HistoryRevisionRecord;
    selected: boolean;
    busy: boolean;
    renamingRevisionId: string | null;
    onSelect: (revisionId: string) => void | Promise<void>;
    onSave: (revisionId: string, label: string) => void | Promise<void>;
    onRemove: (revisionId: string) => void | Promise<void>;
  } = $props();

  const editing = $derived(renamingRevisionId === revision.revisionId);
  let trigger = $state<HTMLButtonElement | null>(null);

  async function finishEditing() {
    if (!editing) return;
    renamingRevisionId = null;
    await tick();
    if (renamingRevisionId === null) trigger?.focus();
  }

  async function save(revisionId: string, label: string) {
    await onSave(revisionId, label);
    await tick();
    // Keep the draft open if the session reports a failed or skipped save.
    if (revision.revisionLabel === label) await finishEditing();
  }

  async function remove(revisionId: string) {
    await onRemove(revisionId);
    await tick();
    if (revision.revisionLabel === null) await finishEditing();
  }
</script>

<div class={`group relative rounded-r-lg border-l-2 ${selected ? 'border-foreground/60 bg-muted/72' : 'border-transparent hover:bg-muted/50'}`}>
  {#if editing}
    <div class="px-3 py-2">
      <RevisionNameEditor
        revisionId={revision.revisionId}
        label={revision.revisionLabel}
        disabled={busy}
        onSave={save}
        onRemove={remove}
        onCancel={() => void finishEditing()}
      />
    </div>
  {:else}
    <button
      bind:this={trigger}
      type="button"
      class="w-full px-3 py-3 pr-9 text-left"
      aria-pressed={selected}
      aria-disabled={busy}
      data-revision-id={revision.revisionId}
      title="Double-click or right-click to rename revision. Keyboard: F2."
      onclick={() => { if (!busy) void onSelect(revision.revisionId); }}
      ondblclick={() => (renamingRevisionId = revision.revisionId)}
      oncontextmenu={(event) => { event.preventDefault(); renamingRevisionId = revision.revisionId; }}
      onkeydown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          renamingRevisionId = revision.revisionId;
        }
      }}
    >
      <HistoryRevisionSummary {revision} />
    </button>
    <button
      type="button"
      class="absolute top-2 right-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-foreground [@media(hover:none)]:opacity-100"
      aria-label="Rename revision"
      title="Rename revision"
      onclick={() => (renamingRevisionId = revision.revisionId)}
    ><Pencil class="h-3 w-3" /></button>
  {/if}
</div>
