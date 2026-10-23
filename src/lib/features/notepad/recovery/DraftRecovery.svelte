<script lang="ts">
  import type { DraftRecoveryController } from './draftRecoveryController.svelte';
  let { recovery }: { recovery: DraftRecoveryController } = $props();
</script>

{#if recovery.backups.length || recovery.backupError || recovery.loadError || recovery.actionError}
  <aside class="draft-recovery" aria-label="Recoverable work" data-testid="draft-recovery">
    {#if recovery.backupError}
      <p role="status">{recovery.backupError} <button onclick={() => void recovery.retry()}>Retry backup</button></p>
    {/if}
    {#if recovery.loadError}
      <p role="status">{recovery.loadError} <button disabled={recovery.isLoading} onclick={() => void recovery.load()}>Retry recovery</button></p>
    {/if}
    {#if recovery.actionError}<p role="alert">{recovery.actionError}</p>{/if}
    {#if recovery.backups.length}
      <details>
        <summary>Recoverable work ({recovery.backups.length})</summary>
        <p>Restore unfinished edits to their original note, or continue a never-saved idea.</p>
        <ul>
          {#each recovery.backups as backup (backup.id)}
            <li>
              <span>{backup.title.trim() || backup.markdown.trim().split('\n')[0]?.slice(0, 90) || 'Untitled idea'}</span>
              <div>
                <button disabled={Boolean(recovery.resumingId)} onclick={() => void recovery.resume(backup)}>{recovery.resumingId === backup.id ? 'Recovering…' : 'Recover work'}</button>
                <button disabled={Boolean(recovery.resumingId)} onclick={() => void recovery.discard(backup)} aria-label={`Discard recovery backup: ${backup.title.trim() || 'Untitled idea'}`}>Discard</button>
              </div>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </aside>
{/if}

<style>
  .draft-recovery { position: relative; z-index: 35; flex-shrink: 0; align-self: center; width: min(34rem, calc(100% - 2rem)); margin: .5rem 0; padding: .5rem .75rem; border: 1px solid var(--color-border); border-radius: .75rem; background: var(--color-popover); color: var(--color-popover-foreground); box-shadow: 0 4px 16px #0001; font-size: .8125rem; }
  summary { cursor: pointer; font-weight: 600; }
  p { margin: .25rem 0; color: var(--color-muted-foreground); }
  ul { max-height: min(16rem, 40dvh); overflow-y: auto; padding: 0; margin: .5rem 0 0; list-style: none; }
  li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .5rem 0; border-top: 1px solid var(--color-border); }
  li span { min-width: 0; overflow-wrap: anywhere; flex: 1 1 12rem; }
  li div { display: flex; gap: .5rem; }
  button { min-height: 2rem; padding: .25rem .5rem; border: 1px solid var(--color-border); border-radius: .5rem; }
  button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }
  button:disabled { opacity: .5; }
  @media (max-width: 639px), (any-pointer: coarse) and (max-height: 559px) {
    /* Compact title and tab navigation are absolute app-shell chrome. */
    .draft-recovery { margin-top: calc(var(--app-shell-top-inset, 0px) + 4rem + .5rem); }
  }
</style>
