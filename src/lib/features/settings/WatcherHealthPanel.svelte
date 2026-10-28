<script lang="ts">
  import type { WatcherHealth } from '#lib/types/vault.js';
  let { health }: { health: WatcherHealth | null } = $props();
  const warning = $derived(health?.status === 'degraded' || health?.status === 'unavailable');
</script>

<section
  class="watcher-health rounded-xl border border-border px-5 py-4 text-sm text-foreground"
  class:warning
  data-settings-anchor="watcher-health"
  aria-labelledby="watcher-health-title"
>
  <h3 id="watcher-health-title" class="font-medium">External file changes</h3>
  <div role="status" aria-live="polite" aria-atomic="true" class="mt-2 space-y-2">
    {#if !health || health.status === 'starting'}
      <p>Starting file watching…</p>
    {:else if health.status === 'watching'}
      <p>Watching the Running Vault for changes made outside Gneauxghts.</p>
      <p class="text-muted-foreground">Periodic scans also check for missed changes.</p>
    {:else if health.status === 'stopped'}
      <p>File watching has stopped while the app closes the Running Vault.</p>
    {:else}
      <p class="font-medium">{health.status === 'unavailable' ? 'File watching could not start.' : 'File watching reported an error.'}</p>
      {#if health.reason === 'watchLimit'}
        <p>The operating system’s file-watch limit was reached. Close other apps that watch many files to free capacity.</p>
      {:else if health.reason === 'permissionDenied'}
        <p>The operating system denied access. Check that Gneauxghts can access the Running Vault.</p>
      {/if}
      {#if health.reconciliationRunning}
        {#if health.status === 'unavailable'}
          <p>Periodic scans check for changes every 15 seconds when the vault is accessible. File watching retries automatically, with up to five minutes between attempts.</p>
        {:else}
          <p>Periodic scans remain active, but changes made outside the app may take longer to appear.</p>
        {/if}
      {:else}
        <p>Periodic scans are not running. Changes made outside the app may not appear until you restart.</p>
      {/if}
      {#if health.status === 'unavailable' && health.reconciliationRunning}
        <p>The startup warning clears when file watching starts successfully.</p>
      {:else if health.status === 'degraded'}
        <p>This warning stays visible until restart. Restart Gneauxghts to try file watching again.</p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .warning {
    border-color: color-mix(in oklab, #d97706 50%, var(--border));
    background: color-mix(in oklab, #d97706 8%, var(--card));
  }
</style>
